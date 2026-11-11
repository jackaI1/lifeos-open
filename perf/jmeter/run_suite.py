"""Runs the LifeOS JMeter plans against a fresh, disposable server, then writes the report.

    python3 perf/jmeter/run_suite.py --profile smoke              # CI: short runs of three plans
    python3 perf/jmeter/run_suite.py --profile full --plans load  # one real plan, full length

For each plan this script:
  1. makes a temporary workspace with fictional data and a random access token;
  2. starts `node --trace-gc build/server.mjs` on a free port (the server must be built first);
  3. seeds calendar events so the workspace is not empty;
  4. starts the resource sampler (CPU, memory, SQLite timings);
  5. runs `jmeter -n -t plans/<plan>.jmx -l results.jtl -e -o dashboard`;
  6. stops the sampler and the server, then checks that the process and port are gone.

Every process it starts is recorded in <out>/<plan>/meta.json with its PID, start time,
port and the command that stops it. Nothing else on the machine is touched.
Then analyze.py writes report.md, report.html and summary.json. The exit status is 1 if any check failed.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))

from analyze import write_report, analyze_plan  # noqa: E402
from resources import ResourceSampler  # noqa: E402

CONFIG = json.loads((HERE / "plans.json").read_text(encoding="utf-8"))
SMOKE_PLANS = ["benchmark", "load", "endurance"]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def process_start_time(pid: int) -> str:
    return subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], capture_output=True, text=True).stdout.strip()


class Server:
    """One LifeOS server process that this script owns. stop() is idempotent and verifies the exit."""

    def __init__(self, plan: str, workdir: Path, gc_log: Path):
        self.plan = plan
        self.workdir = workdir
        self.port = free_port()
        self.origin = f"http://127.0.0.1:{self.port}"
        self.token = secrets.token_hex(24)
        self.database = workdir / "workspace.sqlite"
        self.gc_log = gc_log
        self.process: subprocess.Popen | None = None
        self.ownership: dict = {}

    def start(self) -> None:
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(self.workdir),
            "PORT": str(self.port),
            "APP_ORIGIN": self.origin,
            "AUTH_MODE": "local",
            "LOCAL_ACCESS_TOKEN": self.token,
            "LIFEOS_DATABASE": str(self.database),
            "DEMO_SEED": "true",
            "LLM_MODE": "mock",
            "GOOGLE_MODE": "local",
        }
        log = self.gc_log.open("w", encoding="utf-8")
        self.process = subprocess.Popen(
            ["node", "--trace-gc", "build/server.mjs"],
            cwd=REPO, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        log.close()
        self.ownership = {
            "owner": f"lifeos-open perf run: {self.plan}",
            "pid": self.process.pid,
            "start": process_start_time(self.process.pid),
            "port": self.port,
            "scope": "fictional workspace in a temporary directory, deleted at the end",
            "cleanup": f"kill -TERM {self.process.pid}",
        }
        self._wait_healthy()

    def _request(self, method: str, path: str, body: str | None = None, headers: dict | None = None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.getheader("Set-Cookie"), response.read()
        finally:
            conn.close()

    def _sign_in(self) -> str:
        status, cookie, _ = self._request(
            "POST", "/auth/local", body=f"token={self.token}",
            headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": self.origin},
        )
        if status != 303 or not cookie:
            raise RuntimeError(f"sign-in failed with HTTP {status}")
        return cookie.split(";", 1)[0]

    def _wait_healthy(self, timeout_s: float = 90) -> None:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"server exited early with code {self.process.returncode}")
            try:
                cookie = self._sign_in()
                status, _, body = self._request("GET", "/api/health", headers={"Cookie": cookie})
                if status == 200 and b'"status":"online"' in body:
                    return
            except (OSError, RuntimeError):
                pass
            time.sleep(1)
        raise RuntimeError("server did not become healthy in time")

    def seed_calendar(self, events: int) -> None:
        """Adds fictional calendar events so the reads and searches work on realistic data."""
        if events <= 0:
            return
        cookie = self._sign_in()
        _, _, session = self._request("GET", "/api/session", headers={"Cookie": cookie})
        csrf = json.loads(session)["csrf"]
        headers = {"Cookie": cookie, "Origin": self.origin, "x-lifeos-csrf": csrf, "Content-Type": "application/json"}
        for index in range(events):
            hour = index % 9 + 8
            day = index % 28 + 1
            body = {
                "mutationId": str(uuid.uuid4()), "id": str(uuid.uuid4()), "version": 0,
                "title": f"Fictional seminar {index}", "location": "Fictional room B",
                "start": f"2026-11-{day:02d}T{hour:02d}:00:00.000Z", "end": f"2026-11-{day:02d}T{hour + 1:02d}:00:00.000Z",
                "deleted": False,
            }
            status, _, _ = self._request("POST", "/api/actions/local-calendar", body=json.dumps(body), headers=headers)
            if status != 200:
                raise RuntimeError(f"seeding failed at event {index} with HTTP {status}")

    def stop(self) -> dict:
        """Stops the server, then proves the process and its port are gone."""
        if self.process is None:
            return {"stopped": True}
        if self.process.poll() is None:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=1):
                port_open = True
        except OSError:
            port_open = False
        try:
            os.kill(self.process.pid, 0)
            process_alive = True
        except ProcessLookupError:
            process_alive = False
        result = {"pid": self.process.pid, "port": self.port, "process_alive": process_alive, "port_open": port_open}
        shutil.rmtree(self.workdir, ignore_errors=True)
        result["workspace_deleted"] = not self.workdir.exists()
        if process_alive or port_open:
            raise RuntimeError(f"server did not stop cleanly: {result}")
        return result


def jmeter_properties(plan: str, profile: str) -> dict:
    props = dict(CONFIG["plans"][plan]["properties"])
    if profile == "smoke":
        props.update(CONFIG["plans"][plan].get("smoke", {}))
    return props


def run_plan(plan: str, profile: str, out_dir: Path, jmeter: str, seed_events: int, interval_s: float) -> Path:
    plan_dir = out_dir / plan
    plan_dir.mkdir(parents=True, exist_ok=True)
    props = jmeter_properties(plan, profile)
    workdir = Path(tempfile.mkdtemp(prefix=f"lifeos-perf-{plan}-"))
    server = Server(plan, workdir, plan_dir / "gc.log")
    sampler = None
    started = time.monotonic()
    cleanup: dict = {}
    try:
        server.start()
        server.seed_calendar(seed_events)
        sampler = ResourceSampler(server.process.pid, plan_dir / "samples.csv", interval_s, database=server.database)
        sampler.start()
        command = [
            jmeter, "-n", "-t", str(HERE / "plans" / f"{plan}.jmx"),
            "-l", str(plan_dir / "results.jtl"), "-j", str(plan_dir / "jmeter.log"),
            "-e", "-o", str(plan_dir / "dashboard"),
            "-Jhost=127.0.0.1", f"-Jport={server.port}", f"-Jorigin={server.origin}", f"-Jtoken={server.token}",
        ] + [f"-J{key}={value}" for key, value in props.items()]
        timeout = int(props.get("ramp", 0)) + int(props.get("duration", 0)) + 600
        proc = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        (plan_dir / "jmeter-console.log").write_text(proc.stdout[-20000:] + proc.stderr[-5000:], encoding="utf-8")
        if proc.returncode != 0:
            raise RuntimeError(f"JMeter exited with code {proc.returncode}; see {plan_dir / 'jmeter-console.log'}")
    finally:
        if sampler is not None:
            sampler.stop()
        cleanup = server.stop()
        cleanup["sampler_rows"] = sampler.rows if sampler else 0
    duration_s = time.monotonic() - started
    meta = {
        "plan": plan,
        "profile": profile,
        "properties": props,
        "duration_s": round(duration_s, 1),
        "server": {**server.ownership, "cleanup_result": cleanup},
    }
    (plan_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return plan_dir


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", choices=["smoke", "full"], default="smoke")
    parser.add_argument("--plans", nargs="+", choices=list(CONFIG["plans"]), help="default: smoke set or all plans")
    parser.add_argument("--out", type=Path, default=HERE / "results")
    parser.add_argument("--jmeter", default=os.environ.get("JMETER_BIN", "jmeter"), help="path to the jmeter binary")
    parser.add_argument("--seed-events", type=int, default=300, help="fictional calendar events to add before each run")
    parser.add_argument("--sample-interval", type=float, help="seconds between resource samples (default 2 smoke, 5 full)")
    args = parser.parse_args(argv)

    if shutil.which(args.jmeter) is None and not Path(args.jmeter).exists():
        print(f"JMeter not found: {args.jmeter}. Install Apache JMeter 5.6 or set JMETER_BIN.", file=sys.stderr)
        return 2
    if not (REPO / "build" / "server.mjs").exists():
        print("build/server.mjs is missing. Run `npm ci && npm run build` first.", file=sys.stderr)
        return 2

    plans = args.plans or (SMOKE_PLANS if args.profile == "smoke" else list(CONFIG["plans"]))
    interval = args.sample_interval or (2.0 if args.profile == "smoke" else 5.0)
    out_dir = args.out
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    for plan in plans:
        print(f"== {plan} ({args.profile}) ==", flush=True)
        run_plan(plan, args.profile, out_dir, args.jmeter, args.seed_events, interval)

    results = []
    for plan in plans:
        results.append(analyze_plan(out_dir / plan, CONFIG))
    write_report(out_dir, results)
    for r in results:
        print(f"{r['plan']:<10} {'PASS' if r['passed'] else 'FAIL'}  p95={r['jmeter']['overall']['p95_ms']} ms  "
              f"errors={r['jmeter']['overall']['error_pct']}%  leak={r['leak_check']['status']}")
    print(f"report: {out_dir / 'report.md'}")
    return 0 if all(r["passed"] for r in results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
