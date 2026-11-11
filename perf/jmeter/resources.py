"""Resource sampling for one LifeOS server process during a JMeter run.

Four things are recorded while a plan runs:
  * CPU percent and resident memory (RSS) of the Node process, every few seconds;
  * SQLite query timings: a read-only probe runs two fixed queries on the workspace file;
  * Node garbage-collection pauses, parsed from the `node --trace-gc` log;
  * nothing else. Nothing here changes the database or the server.

Linux (the CI runner) reads /proc, which is exact. macOS falls back to `ps`, which is coarser
but needs no extra tools. Both paths are covered by tests/test_perf.py.
"""

from __future__ import annotations

import csv
import os
import re
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

CLK_TCK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100

SAMPLE_FIELDS = ["t_s", "cpu_pct", "rss_mb", "sqlite_count_ms", "sqlite_list_ms"]

# One pause per collection. Example line from `node --trace-gc`:
#   [41876:0x7f2c60008000]      213 ms: Scavenge 13.6 (15.9) -> 12.5 (16.6) MB, 2.44 / 0.00 ms  (average mu ...)
GC_LINE = re.compile(
    r"\[\d+:[^\]]*\]\s+(?P<at>[\d.]+) ms: (?P<kind>[A-Za-z][A-Za-z ()-]*?) "
    r"[\d.]+ \([\d.]+\) -> [\d.]+ \([\d.]+\) MB, (?P<pause>[\d.]+) / [\d.]+ ms"
)


def parse_proc_stat_ticks(text: str) -> int:
    """utime + stime (in clock ticks) from /proc/<pid>/stat. Fields are counted after the ')' of the command name."""
    fields = text[text.rindex(")") + 2:].split()
    return int(fields[11]) + int(fields[12])


def parse_proc_status_rss_mb(text: str) -> float | None:
    match = re.search(r"^VmRSS:\s+(\d+) kB", text, re.MULTILINE)
    return int(match.group(1)) / 1024 if match else None


def parse_cputime(text: str) -> float:
    """CPU time from `ps -o time=`: [[dd-]hh:]mm:ss[.ff] -> seconds."""
    text = text.strip()
    days = 0
    if "-" in text:
        day_part, text = text.split("-", 1)
        days = int(day_part)
    seconds = 0.0
    for part in text.split(":"):
        seconds = seconds * 60 + float(part)
    return days * 86400 + seconds


def read_process_sample(pid: int) -> tuple[float, float | None]:
    """Returns (cumulative CPU seconds, RSS in MB) for a live process."""
    stat_path = Path(f"/proc/{pid}/stat")
    if stat_path.exists():
        ticks = parse_proc_stat_ticks(stat_path.read_text())
        rss = parse_proc_status_rss_mb(Path(f"/proc/{pid}/status").read_text())
        return ticks / CLK_TCK, rss
    out = subprocess.run(["ps", "-o", "rss=,time=", "-p", str(pid)], capture_output=True, text=True, check=True).stdout.split()
    return parse_cputime(out[1]), int(out[0]) / 1024


def parse_gc_log(text: str) -> list[dict]:
    """Garbage-collection events from a `node --trace-gc` log. Lines that are not GC events are ignored."""
    events = []
    for line in text.splitlines():
        match = GC_LINE.search(line)
        if match:
            events.append({
                "at_ms": float(match.group("at")),
                "kind": match.group("kind").strip(),
                "pause_ms": float(match.group("pause")),
            })
    return events


def summarize_gc(events: list[dict]) -> dict:
    by_kind: dict[str, dict] = {}
    for event in events:
        entry = by_kind.setdefault(event["kind"], {"count": 0, "total_pause_ms": 0.0, "max_pause_ms": 0.0})
        entry["count"] += 1
        entry["total_pause_ms"] += event["pause_ms"]
        entry["max_pause_ms"] = max(entry["max_pause_ms"], event["pause_ms"])
    for entry in by_kind.values():
        entry["total_pause_ms"] = round(entry["total_pause_ms"], 2)
        entry["max_pause_ms"] = round(entry["max_pause_ms"], 2)
    pauses = [e["pause_ms"] for e in events]
    return {
        "count": len(events),
        "total_pause_ms": round(sum(pauses), 2),
        "max_pause_ms": round(max(pauses), 2) if pauses else 0.0,
        "by_kind": by_kind,
    }


class SqliteProbe:
    """Times two fixed read queries on the workspace database. The connection is read-only."""

    QUERIES = {
        "sqlite_count_ms": "SELECT COUNT(*) FROM records",
        "sqlite_list_ms": "SELECT id, data FROM records WHERE kind = 'task' ORDER BY updated_at DESC LIMIT 50",
    }

    def __init__(self, database: Path):
        self.database = database
        self.connection: sqlite3.Connection | None = None

    def open(self) -> None:
        if not self.database.exists():
            return
        self.connection = sqlite3.connect(f"file:{self.database}?mode=ro", uri=True, timeout=2, check_same_thread=False)

    def measure(self) -> dict[str, float | None]:
        result: dict[str, float | None] = {key: None for key in self.QUERIES}
        if self.connection is None:
            return result
        for key, sql in self.QUERIES.items():
            started = time.perf_counter()
            try:
                self.connection.execute(sql).fetchall()
                result[key] = round((time.perf_counter() - started) * 1000, 3)
            except sqlite3.Error:
                result[key] = None
        return result

    def close(self) -> None:
        if self.connection is not None:
            self.connection.close()
            self.connection = None


class ResourceSampler:
    """Background thread that writes one CSV row per interval until stop() is called."""

    def __init__(self, pid: int, csv_path: Path, interval_s: float, database: Path | None = None):
        self.pid = pid
        self.csv_path = csv_path
        self.interval_s = interval_s
        self.probe = SqliteProbe(database) if database else None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="resource-sampler", daemon=True)
        self.rows = 0
        self.errors = 0

    def start(self) -> None:
        self._file = self.csv_path.open("w", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(self._file, fieldnames=SAMPLE_FIELDS)
        self._writer.writeheader()
        if self.probe:
            self.probe.open()
        self._started = time.monotonic()
        self._last_cpu, _ = read_process_sample(self.pid)
        self._last_wall = self._started
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(self.interval_s):
            try:
                self._take_sample()
            except (OSError, subprocess.SubprocessError, ValueError):
                # The process may exit during shutdown. Count it and stop sampling.
                self.errors += 1
                break

    def _take_sample(self) -> None:
        now = time.monotonic()
        cpu_seconds, rss_mb = read_process_sample(self.pid)
        wall = max(now - self._last_wall, 1e-6)
        cpu_pct = round(100 * (cpu_seconds - self._last_cpu) / wall, 2)
        self._last_cpu, self._last_wall = cpu_seconds, now
        queries = self.probe.measure() if self.probe else {key: None for key in SqliteProbe.QUERIES}
        self._writer.writerow({
            "t_s": round(now - self._started, 2),
            "cpu_pct": cpu_pct,
            "rss_mb": None if rss_mb is None else round(rss_mb, 2),
            **queries,
        })
        self._file.flush()
        self.rows += 1

    def stop(self) -> None:
        self._stop.set()
        if self._thread.is_alive():
            self._thread.join(timeout=self.interval_s + 10)
        if self.probe:
            self.probe.close()
        if hasattr(self, "_file"):
            self._file.close()
