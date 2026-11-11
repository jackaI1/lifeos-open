"""Turns the raw results of a performance run into pass/fail checks, a leak flag and a report.

Input, per plan, in <results>/<plan>/:
  results.jtl   JMeter CSV results (written by `jmeter -n -l`)
  samples.csv   CPU, memory and SQLite timings (written by resources.py)
  gc.log        Node `--trace-gc` output
  meta.json     the plan's duration and the server process that was used

Output in <results>/:
  report.md, report.html, summary.json

Run:  python3 perf/jmeter/analyze.py perf/jmeter/results
Exit status is 1 when any evaluated check fails, so CI turns red.
"""

from __future__ import annotations

import csv
import html
import json
import math
import sys
from pathlib import Path

from resources import parse_gc_log, summarize_gc

HERE = Path(__file__).resolve().parent


def percentile(sorted_values: list[float], pct: float) -> float:
    """Nearest-rank percentile. Returns 0.0 for an empty list."""
    if not sorted_values:
        return 0.0
    rank = max(1, math.ceil(pct / 100 * len(sorted_values)))
    return sorted_values[rank - 1]


def load_jtl(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as handle:
        return [
            {
                "label": row["label"],
                "start_ms": int(row["timeStamp"]),
                "elapsed_ms": int(row["elapsed"]),
                "ok": row["success"].lower() == "true",
            }
            for row in csv.DictReader(handle)
        ]


def _stats(rows: list[dict]) -> dict:
    times = sorted(r["elapsed_ms"] for r in rows)
    failures = sum(1 for r in rows if not r["ok"])
    if rows:
        window_s = max(1.0, (max(r["start_ms"] + r["elapsed_ms"] for r in rows) - min(r["start_ms"] for r in rows)) / 1000)
    else:
        window_s = 1.0
    return {
        "count": len(rows),
        "error_pct": round(100 * failures / len(rows), 3) if rows else 0.0,
        "mean_ms": round(sum(times) / len(times), 1) if times else 0.0,
        "p50_ms": percentile(times, 50),
        "p90_ms": percentile(times, 90),
        "p95_ms": percentile(times, 95),
        "p99_ms": percentile(times, 99),
        "max_ms": times[-1] if times else 0,
        "throughput_per_s": round(len(rows) / window_s, 2),
    }


def summarize_jtl(rows: list[dict]) -> dict:
    labels = sorted({r["label"] for r in rows})
    return {
        "overall": _stats(rows),
        "by_label": {label: _stats([r for r in rows if r["label"] == label]) for label in labels},
    }


def load_samples(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            out.append({
                "t_s": float(row["t_s"]),
                "cpu_pct": _num(row["cpu_pct"]),
                "rss_mb": _num(row["rss_mb"]),
                "sqlite_count_ms": _num(row["sqlite_count_ms"]),
                "sqlite_list_ms": _num(row["sqlite_list_ms"]),
            })
    return out


def _num(value: str | None) -> float | None:
    return None if value in (None, "") else float(value)


def resource_summary(samples: list[dict]) -> dict:
    cpu = [s["cpu_pct"] for s in samples if s["cpu_pct"] is not None]
    rss = [s["rss_mb"] for s in samples if s["rss_mb"] is not None]
    out: dict = {
        "samples": len(samples),
        "cpu_mean_pct": round(sum(cpu) / len(cpu), 2) if cpu else None,
        "cpu_peak_pct": max(cpu) if cpu else None,
        "rss_start_mb": rss[0] if rss else None,
        "rss_end_mb": rss[-1] if rss else None,
        "rss_peak_mb": max(rss) if rss else None,
    }
    for key in ("sqlite_count_ms", "sqlite_list_ms"):
        timings = sorted(s[key] for s in samples if s[key] is not None)
        out[key] = {"p50": percentile(timings, 50), "p95": percentile(timings, 95), "max": timings[-1] if timings else None}
    return out


def linear_fit(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    """Least-squares slope, intercept and R-squared."""
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx == 0:
        return 0.0, mean_y, 0.0
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return slope, intercept, r2


def leak_check(samples: list[dict], run_minutes: float, cfg: dict) -> dict:
    """Flags memory that keeps climbing after warm-up.

    A flag needs all three: a steady slope above the limit, a good straight-line fit (R-squared),
    and growth of at least min_growth_pct over the evaluated part of the run. One noisy spike cannot
    trigger it. Short runs are not evaluated, because warm-up alone can look like growth.
    """
    base = {"min_run_minutes": cfg["min_run_minutes"], "run_minutes": round(run_minutes, 1)}
    points = [(s["t_s"], s["rss_mb"]) for s in samples if s["rss_mb"] is not None]
    if run_minutes < cfg["min_run_minutes"]:
        return {**base, "status": "not_evaluated", "possible_leak": False,
                "reason": f"run is shorter than {cfg['min_run_minutes']} minutes; warm-up would look like growth"}
    if len(points) < 30:
        return {**base, "status": "not_evaluated", "possible_leak": False, "reason": "fewer than 30 memory samples"}
    start_t = points[0][0] + cfg["warmup_fraction"] * (points[-1][0] - points[0][0])
    tail = [(t, rss) for t, rss in points if t >= start_t]
    xs = [t for t, _ in tail]
    ys = [rss for _, rss in tail]
    slope, intercept, r2 = linear_fit(xs, ys)
    slope_mb_per_hour = slope * 3600
    fitted_first = intercept + slope * xs[0]
    fitted_last = intercept + slope * xs[-1]
    growth_pct = 100 * (fitted_last - fitted_first) / fitted_first if fitted_first > 0 else 0.0
    flagged = (
        slope_mb_per_hour > cfg["max_slope_mb_per_hour"]
        and r2 >= cfg["min_r2"]
        and growth_pct >= cfg["min_growth_pct"]
    )
    return {
        **base,
        "status": "possible_leak" if flagged else "ok",
        "possible_leak": flagged,
        "slope_mb_per_hour": round(slope_mb_per_hour, 2),
        "r_squared": round(r2, 3),
        "growth_pct_after_warmup": round(growth_pct, 1),
        "reason": "memory keeps rising after warm-up" if flagged else "no steady rise after warm-up",
    }


def evaluate(plan: dict, thresholds: dict, leak: dict, resources: dict) -> list[dict]:
    """Pass/fail checks for one plan. A check is only evaluated when its input exists."""
    checks = []
    # A plan that produced no requests (JMeter failed to start it) must never pass.
    checks.append({"name": "requests recorded", "limit": 1, "actual": plan["overall"]["count"],
                   "passed": plan["overall"]["count"] > 0})

    def check(name: str, limit: float, actual, *, at_most: bool = True) -> None:
        if actual is None:
            checks.append({"name": name, "limit": limit, "actual": None, "passed": True, "note": "no data"})
            return
        passed = actual <= limit if at_most else actual >= limit
        checks.append({"name": name, "limit": limit, "actual": actual, "passed": bool(passed)})

    if "p95_ms" in thresholds:
        check("p95 response time (ms)", thresholds["p95_ms"], plan["overall"]["p95_ms"])
    if "error_pct" in thresholds:
        check("error rate (%)", thresholds["error_pct"], plan["overall"]["error_pct"])
    if "cpu_mean_pct" in thresholds:
        check("mean CPU (%)", thresholds["cpu_mean_pct"], resources.get("cpu_mean_pct"))
    if "rss_peak_mb" in thresholds:
        check("peak memory (MB)", thresholds["rss_peak_mb"], resources.get("rss_peak_mb"))
    if "gc_max_pause_ms" in thresholds:
        check("longest GC pause (ms)", thresholds["gc_max_pause_ms"], plan.get("gc", {}).get("max_pause_ms"))
    if leak["status"] != "not_evaluated":
        checks.append({"name": "steady memory rise (possible leak)", "limit": "not flagged",
                       "actual": "flagged" if leak["possible_leak"] else "not flagged",
                       "passed": not leak["possible_leak"]})
    return checks


def analyze_plan(plan_dir: Path, config: dict) -> dict:
    meta = json.loads((plan_dir / "meta.json").read_text(encoding="utf-8"))
    jtl = summarize_jtl(load_jtl(plan_dir / "results.jtl"))
    gc = summarize_gc(parse_gc_log((plan_dir / "gc.log").read_text(encoding="utf-8", errors="replace"))) if (plan_dir / "gc.log").exists() else {"count": 0}
    samples = load_samples(plan_dir / "samples.csv")
    resources = resource_summary(samples)
    run_minutes = meta["duration_s"] / 60
    leak = leak_check(samples, run_minutes, config["leak_check"]) if meta["plan"] == "endurance" else {
        "status": "not_evaluated", "possible_leak": False, "reason": "leak check runs on the endurance plan only"}
    thresholds = config["plans"][meta["plan"]]["thresholds"]
    checks = evaluate({"overall": jtl["overall"], "gc": gc}, thresholds, leak, resources)
    return {
        "plan": meta["plan"],
        "description": config["plans"][meta["plan"]]["description"],
        "profile": meta["profile"],
        "duration_s": meta["duration_s"],
        "jmeter": jtl,
        "gc": gc,
        "resources": resources,
        "leak_check": leak,
        "checks": checks,
        "passed": all(c["passed"] for c in checks),
        "server": meta.get("server"),
    }


def write_report(results_dir: Path, plans: list[dict]) -> None:
    overall_pass = all(p["passed"] for p in plans)
    summary = {"passed": overall_pass, "plans": plans}
    (results_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    (results_dir / "report.md").write_text(render_markdown(plans, overall_pass), encoding="utf-8")
    (results_dir / "report.html").write_text(render_html(results_dir, plans, overall_pass), encoding="utf-8")


def _fmt(value) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


def render_markdown(plans: list[dict], overall_pass: bool) -> str:
    lines = [
        "# LifeOS performance run",
        "",
        f"Overall: **{'PASS' if overall_pass else 'FAIL'}**. Each plan starts a fresh server, so the runs do not affect each other.",
        "",
        "| Plan | Profile | Requests | p95 ms | Errors % | Mean CPU % | Peak RSS MB | Leak check | Result |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for p in plans:
        r = p["resources"]
        lines.append(
            f"| {p['plan']} | {p['profile']} | {p['jmeter']['overall']['count']} | {_fmt(p['jmeter']['overall']['p95_ms'])} "
            f"| {_fmt(p['jmeter']['overall']['error_pct'])} | {_fmt(r['cpu_mean_pct'])} | {_fmt(r['rss_peak_mb'])} "
            f"| {p['leak_check']['status']} | {'PASS' if p['passed'] else 'FAIL'} |"
        )
    for p in plans:
        lines += ["", f"## {p['plan']}", "", p["description"], "", "| Check | Limit | Measured | Result |", "| --- | ---: | ---: | --- |"]
        for c in p["checks"]:
            lines.append(f"| {c['name']} | {_fmt(c['limit'])} | {_fmt(c['actual'])} | {'pass' if c['passed'] else 'FAIL'} |")
        lines += ["", "| Request | Count | Errors % | p50 ms | p95 ms | p99 ms | Throughput /s |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for label, s in p["jmeter"]["by_label"].items():
            lines.append(f"| {label} | {s['count']} | {s['error_pct']} | {s['p50_ms']} | {s['p95_ms']} | {s['p99_ms']} | {s['throughput_per_s']} |")
        q = p["resources"]
        lines += [
            "",
            f"Memory: start {_fmt(q['rss_start_mb'])} MB, end {_fmt(q['rss_end_mb'])} MB, peak {_fmt(q['rss_peak_mb'])} MB. "
            f"SQLite count p95 {_fmt(q['sqlite_count_ms']['p95'])} ms, list p95 {_fmt(q['sqlite_list_ms']['p95'])} ms. "
            f"GC pauses: {p['gc'].get('count', 0)} events, longest {_fmt(p['gc'].get('max_pause_ms'))} ms.",
            "",
            f"Leak check: {p['leak_check']['status']}. {p['leak_check']['reason']}.",
            "",
            f"JMeter dashboard: [{p['plan']}/dashboard/index.html]({p['plan']}/dashboard/index.html)",
        ]
    return "\n".join(lines) + "\n"


def _svg_line(values: list[float | None], times: list[float], title: str, unit: str) -> str:
    width, height, pad = 640, 150, 34
    points = [(t, v) for t, v in zip(times, values) if v is not None]
    if not points:
        return f"<p>{html.escape(title)}: no data</p>"
    t_max = max(times) or 1
    v_max = max(v for _, v in points) or 1
    coords = " ".join(
        f"{pad + (t / t_max) * (width - 2 * pad):.1f},{height - pad - (v / v_max) * (height - 2 * pad):.1f}" for t, v in points
    )
    return (
        f"<figure><figcaption>{html.escape(title)} (peak {v_max:.1f} {unit})</figcaption>"
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" aria-label="{html.escape(title)}">'
        f'<line x1="{pad}" y1="{height - pad}" x2="{width - pad}" y2="{height - pad}" stroke="#888"/>'
        f'<line x1="{pad}" y1="{pad}" x2="{pad}" y2="{height - pad}" stroke="#888"/>'
        f'<polyline fill="none" stroke="#2b6cb0" stroke-width="2" points="{coords}"/></svg></figure>'
    )


def render_html(results_dir: Path, plans: list[dict], overall_pass: bool) -> str:
    body = [f"<h1>LifeOS performance run: {'PASS' if overall_pass else 'FAIL'}</h1>"]
    for p in plans:
        samples = load_samples(results_dir / p["plan"] / "samples.csv")
        times = [s["t_s"] for s in samples]
        body.append(f"<section><h2>{html.escape(p['plan'])}</h2><p>{html.escape(p['description'])}</p>")
        body.append("<table><tr><th>Check</th><th>Limit</th><th>Measured</th><th>Result</th></tr>")
        for c in p["checks"]:
            body.append(f"<tr><td>{html.escape(c['name'])}</td><td>{_fmt(c['limit'])}</td><td>{_fmt(c['actual'])}</td>"
                        f"<td>{'pass' if c['passed'] else 'FAIL'}</td></tr>")
        body.append("</table>")
        body.append(_svg_line([s["rss_mb"] for s in samples], times, "Resident memory", "MB"))
        body.append(_svg_line([s["cpu_pct"] for s in samples], times, "CPU", "%"))
        body.append(_svg_line([s["sqlite_list_ms"] for s in samples], times, "SQLite task list query", "ms"))
        body.append(f"<p>Leak check: {html.escape(p['leak_check']['status'])}. {html.escape(p['leak_check']['reason'])}.</p>")
        body.append(f"<p><a href=\"{html.escape(p['plan'])}/dashboard/index.html\">JMeter dashboard</a></p></section>")
    style = "body{font-family:system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#1a202c}table{border-collapse:collapse}td,th{border:1px solid #cbd5e0;padding:.3rem .6rem;text-align:left}figure{margin:1rem 0}"
    return f"<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>LifeOS performance run</title><style>{style}</style><body>{''.join(body)}</body></html>\n"


def main(argv: list[str]) -> int:
    results_dir = Path(argv[0]) if argv else HERE / "results"
    config = json.loads((HERE / "plans.json").read_text(encoding="utf-8"))
    plan_dirs = sorted(p for p in results_dir.iterdir() if (p / "meta.json").exists())
    if not plan_dirs:
        print(f"no plan results found in {results_dir}", file=sys.stderr)
        return 2
    plans = []
    for plan_dir in plan_dirs:
        plans.append(analyze_plan(plan_dir, config))
    write_report(results_dir, plans)
    for p in plans:
        status = "PASS" if p["passed"] else "FAIL"
        print(f"{p['plan']:<10} {status}  p95={p['jmeter']['overall']['p95_ms']} ms  errors={p['jmeter']['overall']['error_pct']}%  leak={p['leak_check']['status']}")
    print(f"report: {results_dir / 'report.md'}")
    return 0 if all(p["passed"] for p in plans) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
