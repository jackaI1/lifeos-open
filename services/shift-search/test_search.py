import json
import os
from pathlib import Path
import pytest
from search import connect, migrate_and_seed, search

pytestmark = pytest.mark.skipif(not os.getenv("SHIFT_DATABASE_URL"), reason="Requires real PostgreSQL and local embedding worker")


def test_real_fulltext_pgvector_fusion_and_labelled_recall():
    questions = json.loads(Path(__file__).with_name("questions.json").read_text())
    report = {}
    with connect() as db:
        migrate_and_seed(db)
        assert db.execute("SELECT count(*) AS n FROM shift_passages").fetchone()["n"] == 8
        for mode in ("fulltext", "vector", "hybrid"):
            cases = []
            for case in questions:
                result = search(db, case["question"], mode=mode)
                hit = case["expected"] in [r["id"] for r in result["candidates"]] if case["expected"] else result["abstained"]
                cases.append({**case, "hit_at_3": hit, "abstained": result["abstained"], "ids": [s["id"] for s in result["candidates"]]})
                if not result["abstained"]:
                    assert result["answer"] == result["sources"][0]["passage"]
                    assert all(source["document"] and source["shift"] and source["passage"] for source in result["sources"])
            answerable = [c for c in cases if c["expected"]]
            report[mode] = {"recall_at_3": sum(c["hit_at_3"] for c in answerable) / len(answerable), "cases": cases}
        output = Path(os.getenv("SHIFT_REPORT", "evaluation.json"))
        output.write_text(json.dumps(report, indent=2))
        assert report["hybrid"]["recall_at_3"] >= 0.75
        assert all(c["abstained"] for c in report["hybrid"]["cases"] if c["expected"] is None)
        with pytest.raises(ValueError):
            search(db, " ")
