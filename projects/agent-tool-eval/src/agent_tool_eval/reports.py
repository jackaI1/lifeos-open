"""Small summary, failure breakdown, spreadsheet-safe CSV and full JSON traces."""

import csv
import json
from collections import Counter
from pathlib import Path

from .runner import METRICS


def percent(value):
    return "N/A" if value is None else f"{value:.1%}"


def cell(value):
    return str(value).replace("|", r"\|").replace("\n", " ").replace("\r", " ")[:240]


def csv_safe(value):
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def write_reports(report, destination):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    runs, summary = report["runs"], report["summary"]
    metadata = report["metadata"]
    lines = [
        "# Tool-use evaluation report",
        "",
        f"Backend: {cell(metadata.get('backend', 'unspecified'))}",
        "",
        f"Model: {cell(metadata.get('model', 'unspecified'))}",
        "",
        f"Tasks: {summary['tasks']} | Runs: {summary['runs']} | Repeats: {metadata['repeats']}",
        "",
        "| Measure | Score |",
        "| --- | ---: |",
    ]
    for metric in (*METRICS, "pass_rate", "consistency"):
        lines.append(f"| {metric} | {percent(summary[metric])} |")
    lines += [
        "",
        "Argument validity means every attempted call met its JSON schema. "
        "A missing call is caught by tool selection and argument accuracy. "
        "Consistency is the most common completed tool trace and answer divided by "
        "all repeats, averaged over tasks. It does not measure correctness; "
        "a single repeat is N/A.",
        "",
        "## Failures by category",
        "",
        "| Category | Failed runs |",
        "| --- | ---: |",
    ]
    counts = Counter(category for run in runs for category in run["failures"])
    for category, count in sorted(counts.items()):
        lines.append(f"| {cell(category)} | {count} |")
    if not counts:
        lines.append("| none | 0 |")
    lines += [
        "",
        "One run may fail several categories.",
        "",
        "## Failed runs",
        "",
        "| Task | Repeat | Categories | Attempted tools | Final answer |",
        "| --- | ---: | --- | --- | --- |",
    ]
    for run in runs:
        if run["failures"]:
            lines.append(
                f"| {cell(run['task_id'])} | {run['repeat']} | "
                f"{cell(', '.join(run['failures']))} | "
                f"{cell(', '.join(str(c['name']) for c in run['calls']))} | "
                f"{cell(run['answer'])} |"
            )
    if not counts:
        lines.append("| none | | | | |")
    lines += [
        "",
        "## Reproduction settings",
        "",
        "```json",
        json.dumps(metadata, indent=2, sort_keys=True),
        "```",
        "",
        "See runs.csv for every run and traces.json for tool arguments, results and messages.",
        "",
    ]
    (destination / "report.md").write_text("\n".join(lines))
    columns = [
        "task_id",
        "category",
        "repeat",
        "seed",
        *METRICS,
        "passed",
        "consistency",
        "failures",
        "answer",
    ]
    with (destination / "runs.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        for run in runs:
            row = {key: run.get(key) for key in columns}
            row["consistency"] = report["consistency"][run["task_id"]]
            row["failures"] = ";".join(run["failures"])
            writer.writerow({key: csv_safe(value) for key, value in row.items()})
    (destination / "traces.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
