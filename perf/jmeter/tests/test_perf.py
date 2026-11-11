"""Tests for the performance tooling. They need no JMeter and no server.

Run:  python3 -m unittest discover -s perf/jmeter/tests -v
"""

from __future__ import annotations

import csv
import json
import random
import sqlite3
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import analyze  # noqa: E402
import build_plans  # noqa: E402
import resources  # noqa: E402

CONFIG = json.loads((HERE / "plans.json").read_text(encoding="utf-8"))
LEAK_CFG = CONFIG["leak_check"]

GC_SAMPLE = """\
Starting LifeOS
[41876:0x7f2c60008000]      213 ms: Scavenge 13.6 (15.9) -> 12.5 (16.6) MB, 2.44 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure
[41876:0x7f2c60008000]     2196 ms: Mark-Compact 27.0 (30.3) -> 22.0 (28.0) MB, 13.36 / 0.00 ms  (average mu = 0.980, current mu = 0.960) task
[41876:0x7f2c60008000]     2300 ms: Mark-Compact (reduce) 22.0 (28.0) -> 21.0 (27.0) MB, 0.91 / 0.00 ms  (average mu = 0.980) finalize
listening on http://127.0.0.1:8787
"""


class PercentileTests(unittest.TestCase):
    def test_nearest_rank(self):
        values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
        self.assertEqual(analyze.percentile(values, 50), 50)
        self.assertEqual(analyze.percentile(values, 95), 100)
        self.assertEqual(analyze.percentile(values, 10), 10)

    def test_empty_is_zero(self):
        self.assertEqual(analyze.percentile([], 95), 0.0)


class JtlTests(unittest.TestCase):
    def test_summary_counts_errors_and_labels(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "results.jtl"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["timeStamp", "elapsed", "label", "responseCode", "responseMessage", "threadName",
                                 "dataType", "success", "failureMessage", "bytes", "sentBytes", "grpThreads",
                                 "allThreads", "URL", "Latency", "IdleTime", "Connect"])
                for i in range(100):
                    ok = "false" if i < 2 else "true"
                    writer.writerow([1000 + i * 100, 100 + i, "Calendar read", "200", "OK", "t", "text", ok,
                                     "", 0, 0, 1, 1, "", 0, 0, 0])
                writer.writerow([2000, 900, "Sign in", "303", "See Other", "t", "text", "true", "", 0, 0, 1, 1, "", 0, 0, 0])
            summary = analyze.summarize_jtl(analyze.load_jtl(path))
        self.assertEqual(summary["overall"]["count"], 101)
        self.assertAlmostEqual(summary["by_label"]["Calendar read"]["error_pct"], 2.0)
        self.assertEqual(summary["by_label"]["Sign in"]["count"], 1)
        self.assertGreater(summary["overall"]["throughput_per_s"], 0)


class GcTests(unittest.TestCase):
    def test_parses_scavenge_mark_compact_and_ignores_other_lines(self):
        events = resources.parse_gc_log(GC_SAMPLE)
        self.assertEqual([e["kind"] for e in events], ["Scavenge", "Mark-Compact", "Mark-Compact (reduce)"])
        self.assertEqual(events[1]["pause_ms"], 13.36)

    def test_summary_totals_and_max(self):
        summary = resources.summarize_gc(resources.parse_gc_log(GC_SAMPLE))
        self.assertEqual(summary["count"], 3)
        self.assertEqual(summary["max_pause_ms"], 13.36)
        self.assertEqual(summary["by_kind"]["Scavenge"]["count"], 1)


class ProcessParsingTests(unittest.TestCase):
    def test_proc_stat_ticks_counts_after_command_name(self):
        # Field 14 (utime) and 15 (stime) are 1-based fields of /proc/<pid>/stat.
        stat = "123 (node server) S " + " ".join(str(i) for i in range(3, 52))
        fields = stat[stat.rindex(")") + 2:].split()
        expected = int(fields[11]) + int(fields[12])
        self.assertEqual(resources.parse_proc_stat_ticks(stat), expected)

    def test_rss_from_status(self):
        status = "Name:\tnode\nVmPeak:\t 900000 kB\nVmRSS:\t   51200 kB\nThreads: 11\n"
        self.assertEqual(resources.parse_proc_status_rss_mb(status), 50.0)

    def test_cputime_formats(self):
        self.assertAlmostEqual(resources.parse_cputime("0:01.25"), 1.25)
        self.assertAlmostEqual(resources.parse_cputime("01:02:03"), 3723.0)
        self.assertAlmostEqual(resources.parse_cputime("1-00:00:10"), 86410.0)


class SqliteProbeTests(unittest.TestCase):
    def test_times_fixed_queries_on_a_read_only_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "workspace.sqlite"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE records(kind TEXT, id TEXT, data TEXT, version INTEGER, created_at TEXT, updated_at TEXT)")
            con.executemany("INSERT INTO records VALUES ('task', ?, '{}', 0, '', ?)",
                            [(str(i), str(i)) for i in range(200)])
            con.commit()
            con.close()
            probe = resources.SqliteProbe(db)
            probe.open()
            timings = probe.measure()
            probe.close()
            ro = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try:
                # The probe opens the database read-only, so writes must fail.
                with self.assertRaises(sqlite3.OperationalError):
                    ro.execute("DELETE FROM records")
            finally:
                ro.close()
        self.assertIsNotNone(timings["sqlite_count_ms"])
        self.assertIsNotNone(timings["sqlite_list_ms"])

    def test_missing_database_gives_no_timings(self):
        probe = resources.SqliteProbe(Path("/nonexistent/workspace.sqlite"))
        probe.open()
        self.assertEqual(probe.measure(), {"sqlite_count_ms": None, "sqlite_list_ms": None})


class LeakCheckTests(unittest.TestCase):
    @staticmethod
    def samples(rss_for_minute, minutes=40, noise=0.0, seed=1):
        rng = random.Random(seed)
        out = []
        for i in range(minutes * 12):  # one sample every 5 seconds
            t = i * 5.0
            value = rss_for_minute(t / 60) + rng.uniform(-noise, noise)
            out.append({"t_s": t, "rss_mb": value, "cpu_pct": 10.0, "sqlite_count_ms": 1.0, "sqlite_list_ms": 1.0})
        return out

    def test_flat_memory_with_noise_is_not_flagged(self):
        samples = self.samples(lambda m: 180.0, noise=3.0)
        result = analyze.leak_check(samples, 40, LEAK_CFG)
        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["possible_leak"])

    def test_steady_rise_is_flagged(self):
        # About 60 MB per hour of steady growth after warm-up.
        samples = self.samples(lambda m: 150.0 + 60.0 * m / 60, noise=1.0)
        result = analyze.leak_check(samples, 40, LEAK_CFG)
        self.assertEqual(result["status"], "possible_leak")
        self.assertTrue(result["possible_leak"])
        self.assertGreater(result["slope_mb_per_hour"], LEAK_CFG["max_slope_mb_per_hour"])

    def test_short_run_is_not_evaluated(self):
        samples = self.samples(lambda m: 150.0 + 50.0 * m, minutes=5)
        result = analyze.leak_check(samples, 5, LEAK_CFG)
        self.assertEqual(result["status"], "not_evaluated")
        self.assertFalse(result["possible_leak"])

    def test_warmup_growth_is_ignored(self):
        # A fast rise in the first 25% (warm-up) then flat: not a leak.
        def curve(m):
            return 150.0 + min(m, 10) * 8.0
        samples = self.samples(curve, minutes=40)
        result = analyze.leak_check(samples, 40, LEAK_CFG)
        self.assertFalse(result["possible_leak"])


class ThresholdTests(unittest.TestCase):
    def test_failing_p95_and_error_rate_fail_the_plan(self):
        plan = {"overall": {"count": 50, "p95_ms": 900.0, "error_pct": 0.2}, "gc": {"count": 0}}
        checks = analyze.evaluate(plan, {"p95_ms": 800, "error_pct": 1.0}, {"status": "not_evaluated", "possible_leak": False},
                                  {"cpu_mean_pct": 10, "rss_peak_mb": 100})
        results = {c["name"]: c["passed"] for c in checks}
        self.assertFalse(results["p95 response time (ms)"])
        self.assertTrue(results["error rate (%)"])

    def test_a_flagged_leak_fails_the_plan(self):
        plan = {"overall": {"count": 50, "p95_ms": 1.0, "error_pct": 0.0}, "gc": {"count": 0}}
        leak = {"status": "possible_leak", "possible_leak": True}
        checks = analyze.evaluate(plan, {}, leak, {})
        self.assertEqual(checks[-1]["name"], "steady memory rise (possible leak)")
        self.assertFalse(checks[-1]["passed"])

    def test_a_plan_with_no_requests_fails(self):
        plan = {"overall": {"count": 0, "p95_ms": 0.0, "error_pct": 0.0}, "gc": {"count": 0}}
        checks = analyze.evaluate(plan, {"p95_ms": 800}, {"status": "not_evaluated", "possible_leak": False}, {})
        self.assertEqual(checks[0]["name"], "requests recorded")
        self.assertFalse(checks[0]["passed"])

    def test_missing_resource_data_is_not_a_failure(self):
        plan = {"overall": {"count": 50, "p95_ms": 1.0, "error_pct": 0.0}, "gc": {"count": 0}}
        checks = analyze.evaluate(plan, {"cpu_mean_pct": 85}, {"status": "not_evaluated", "possible_leak": False}, {})
        self.assertTrue(all(c["passed"] for c in checks))


class PlanTests(unittest.TestCase):
    def test_committed_jmx_matches_the_generator(self):
        for name, plan in CONFIG["plans"].items():
            expected = build_plans.build_plan(name, plan["description"], bool(plan["properties"].get("scheduled")))
            actual = (HERE / "plans" / f"{name}.jmx").read_text(encoding="utf-8")
            self.assertEqual(actual, expected, f"plans/{name}.jmx is stale; run python3 perf/jmeter/build_plans.py")

    def test_each_plan_covers_the_four_journeys(self):
        for name in CONFIG["plans"]:
            root = ET.parse(HERE / "plans" / f"{name}.jmx").getroot()
            labels = {el.get("testname") for el in root.iter("HTTPSamplerProxy")}
            self.assertEqual(labels, {"Sign in", "Session", "Calendar read", "Calendar write", "Search tasks"}, name)

    def test_every_plan_has_thresholds(self):
        for name, plan in CONFIG["plans"].items():
            self.assertTrue(plan["thresholds"], name)


if __name__ == "__main__":
    unittest.main()
