"""Query MLflow, export all runs and compare only matching serving cohorts."""

import csv
import json
import re
from pathlib import Path

from mlflow import MlflowClient

from llm_eval.data import canonical
from llm_eval.tracking import EXPERIMENT, tracking


def comparison_report(output_dir, tracking_dir="runs/mlruns"):
    tracking(tracking_dir)
    client = MlflowClient()
    experiment = client.get_experiment_by_name(EXPERIMENT)
    # Page through the whole experiment rather than silently dropping runs at a search limit.
    records, token = [], None
    while True:
        page = client.search_runs([experiment.experiment_id], max_results=1000, page_token=token)
        records.extend(
            {
                "run_id": r.info.run_id,
                "status": r.info.status,
                "kind": r.data.tags.get("kind", "legacy"),
                "training_run_id": r.data.tags.get("training_run_id", ""),
                "params": r.data.params,
                "metrics": r.data.metrics,
            }
            for r in page
        )
        token = page.token
        if not token:
            break
    output = Path(output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Comparison output directory is not empty")
    output.mkdir(parents=True, exist_ok=True)
    (output / "runs.json").write_text(json.dumps(records, indent=2) + "\n")
    columns = ["run_id", "status", "kind", "training_run_id"]
    columns += [
        f"{category}.{key}"
        for category in ("params", "metrics")
        for key in sorted({k for r in records for k in r[category]})
    ]
    with (output / "runs.csv").open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        for record in records:
            writer.writerow(
                {
                    **{k: v for k, v in record.items() if k not in ("params", "metrics")},
                    **{
                        f"{category}.{k}": v
                        for category in ("params", "metrics")
                        for k, v in record[category].items()
                    },
                }
            )
    lines = [
        "# Quality and serving speed",
        "",
        "All operations, including failed runs, are in runs.csv and runs.json.",
        "Tables group identical model, data, prompts, adapter, engine and request settings.",
        "Each row is an independent run; repeated runs remain visible, not overwritten.",
        "Latency is the full non-streaming request, including queueing. Warmups are excluded.",
        "Throughput is successful output tokens divided by wall time for all requests.",
        "Failed requests get zero quality credit; failed runs are excluded from tables.",
        "",
    ]
    groups = {}
    for record in records:
        if record["kind"] == "serving-evaluation" and record["status"] == "FINISHED":
            groups.setdefault(record["params"]["comparison_key"], []).append(record)
    for key, runs in sorted(groups.items()):
        p = runs[0]["params"]
        lines += [
            f"## {p['backend']} on {p['device']}: {key[:12]}",
            "",
            f"Model: {p['model']}, test rows: {p['n_test']}, concurrency: {p['concurrency']}, "
            f"token limit: {p['max_tokens']}.",
            "",
            "| Variant | Run | Exact match | Field F1 | Output tokens/s "
            "| p50 seconds | p95 seconds |",
            "|---|---|---:|---:|---:|---:|---:|",
        ]
        if {r["params"]["variant"] for r in runs} != {"base", "merged"}:
            lines += ["| Incomplete pair: run both base and merged | | | | | | |"]
        for record in sorted(runs, key=lambda r: (r["params"]["variant"], r["run_id"])):
            m = record["metrics"]
            values = " | ".join(
                f"{m[k]:.4f}"
                for k in (
                    "exact_match",
                    "field_f1",
                    "output_tokens_per_s",
                    "latency_p50_s",
                    "latency_p95_s",
                )
            )
            lines.append(f"| {record['params']['variant']} | {record['run_id']} | {values} |")
        lines.append("")
    if not groups:
        lines.append("No completed serving runs yet. Run serve-compare first.")
    (output / "comparison.md").write_text("\n".join(lines) + "\n")
    return {
        "runs": len(records),
        "serving_cohorts": len(groups),
        "report": str(output / "comparison.md"),
    }


def code_block(text, language):
    longest = max((len(m.group()) for m in re.finditer(r"`+", text)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{language}\n{text}\n{fence}\n"


def render_failures(records):
    parts = ["# Held-out failures\n", "All inputs below are fabricated.\n"]
    for row in records:
        if row["scores"]["exact_match"]:
            continue
        parts.append(
            f"## {row['variant']}: {row['id']}\n\nInput:\n"
            + code_block(row["input"], "text")
            + "Expected:\n"
            + code_block(canonical(row["target"]), "json")
            + "Generated:\n"
            + code_block(row["prediction"], "text")
        )
    return "\n".join(parts)
