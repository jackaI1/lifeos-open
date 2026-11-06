"""Check recorded public measurements against their raw generated predictions, offline."""

import json
from pathlib import Path

import pytest

from llm_eval.metrics import score_row, summarize
from llm_eval.report import code_block, render_failures

REPORTS = Path(__file__).resolve().parents[1] / "reports"


@pytest.mark.parametrize("directory", sorted(p.parent for p in REPORTS.glob("*/metrics.json")))
def test_recorded_measurements_reproduce_from_raw_outputs(directory):
    report = json.loads((directory / "metrics.json").read_text())
    records = [
        json.loads(line) for line in (directory / "predictions.jsonl").read_text().splitlines()
    ]
    assert (directory / "failures.md").read_text() == render_failures(records)
    base_cases = {
        r["id"]: (r["input"], r["target"], r["entity_id"])
        for r in records
        if r["variant"] == "base"
    }
    assert len(base_cases) == report["n"]
    for row in records:
        assert (row["input"], row["target"], row["entity_id"]) == base_cases[row["id"]]
    for variant, expected in report["runs"].items():
        rows = [r for r in records if r["variant"] == variant]
        assert [r["id"] for r in rows] == report["row_ids"]
        scores = [score_row(r["prediction"], r["target"]) for r in rows]
        assert scores == [r["scores"] for r in rows]
        assert (
            summarize(scores, report["bootstrap"]["samples"], report["bootstrap"]["seed"])
            == expected
        )


def test_generated_markdown_cannot_close_its_surrounding_code_block():
    text = "An answer:\n```json\n{}\n```"
    rendered = code_block(text, "text")
    assert rendered.startswith("````text\n")
    assert rendered.endswith("\n````\n")
    assert text in rendered
    assert code_block("`````", "text").startswith("``````text\n")
