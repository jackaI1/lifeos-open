import copy
import json

import pytest

from llm_eval.data import SPLITS, audit, load_splits, prepare


def records(path):
    return {
        s: [json.loads(line) for line in (path / f"{s}.jsonl").read_text().splitlines()]
        for s in SPLITS
    }


def test_reproducible_grouped_data(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    assert prepare(a, 32, 8, 8) == prepare(b, 32, 8, 8)
    splits = records(a)
    audit(splits)
    for split in SPLITS:
        assert len({r["entity_id"] for r in splits[split]}) == len(splits[split]) // 2
    loaded, manifest = load_splits(a)
    assert loaded["train"][0]["target"] == splits["train"][0]["target"]
    assert manifest["license"] == "CC0-1.0"
    assert all("SYN-" in r["input"] for rows in splits.values() for r in rows)


@pytest.mark.parametrize("sizes", [(1, 8, 8), (8, 0, 8), (8, 8, -2), (8, 8, 3)])
def test_invalid_sizes(tmp_path, sizes):
    with pytest.raises(ValueError):
        prepare(tmp_path, *sizes)


def test_tampering_detected(tmp_path):
    prepare(tmp_path, 8, 4, 4)
    with (tmp_path / "test.jsonl").open("a") as file:
        file.write("{}\n")
    with pytest.raises(ValueError, match="hash mismatch"):
        load_splits(tmp_path)


@pytest.mark.parametrize("kind", ["input", "entity", "target", "id", "schema", "empty"])
def test_audit_rejects_leakage(tmp_path, kind):
    prepare(tmp_path, 8, 4, 4)
    splits = records(tmp_path)
    source = splits["train"][0]
    row = splits["test"][0]
    if kind == "input":
        row["input"] = "  " + source["input"].upper().replace("\n", "   ") + " "
    elif kind == "entity":
        row["entity_id"] = source["entity_id"]
    elif kind == "target":
        row["target"] = copy.deepcopy(source["target"])
    elif kind == "id":
        row["id"] = source["id"]
    elif kind == "schema":
        row["target"]["extra"] = "bad"
    else:
        splits["test"] = []
    with pytest.raises(ValueError):
        audit(splits)
