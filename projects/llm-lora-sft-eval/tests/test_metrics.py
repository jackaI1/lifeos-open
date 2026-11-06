import json

import pytest

from llm_eval.metrics import bootstrap, paired_delta, parse_prediction, score_row, summarize

TARGET = {"name": "Fiction-0123", "member_id": "SYN-00001", "region": None, "status": "active"}


def test_exact_is_order_independent():
    score = score_row(json.dumps(dict(reversed(list(TARGET.items())))), TARGET)
    assert score["exact_match"] == score["field_f1"] == 1


def test_partial_field_f1():
    prediction = {**TARGET, "status": "pending"}
    score = score_row(json.dumps(prediction), TARGET)
    assert score["exact_match"] == 0
    assert score["field_f1"] == 0.75
    assert score["field_region"] == 1
    assert score["field_status"] == 0


@pytest.mark.parametrize(
    "text",
    [
        "garbage",
        "[]",
        "null",
        "{}",
        "```json\n{}\n```",
        json.dumps({**TARGET, "extra": "x"}),
        json.dumps({**TARGET, "name": 7}),
    ],
)
def test_invalid_outputs_get_zero(text):
    assert parse_prediction(text) is None
    assert score_row(text, TARGET)["field_f1"] == 0
    assert score_row(text, TARGET)["valid_json"] == 0


def test_bootstrap_known_values_and_reproducibility():
    assert bootstrap([1, 1, 1], 100) == {"mean": 1, "ci95": [1, 1]}
    actual = bootstrap([0, 0, 1, 1], 500)
    assert actual["mean"] == 0.5
    assert actual == bootstrap([0, 0, 1, 1], 500)
    assert 0 <= actual["ci95"][0] < actual["ci95"][1] <= 1


def test_paired_delta_and_negative_effects():
    base = [{"exact_match": 1, "field_f1": 0.75}] * 4
    adapter = [{"exact_match": 0, "field_f1": 0.25}] * 4
    delta = paired_delta(base, adapter, 100)
    assert delta["exact_match"]["ci95"] == [-1, -1]
    assert delta["field_f1"]["mean"] == -0.5


@pytest.mark.parametrize(
    "call",
    [
        lambda: bootstrap([]),
        lambda: bootstrap([1], 0),
        lambda: summarize([]),
        lambda: paired_delta([], []),
        lambda: paired_delta([{}], []),
    ],
)
def test_invalid_statistics(call):
    with pytest.raises(ValueError):
        call()


def test_duplicate_json_keys_are_invalid():
    text = json.dumps(TARGET).replace('"name":', '"name":"wrong","name":', 1)
    assert parse_prediction(text) is None
    assert score_row(text, TARGET)["field_f1"] == 0
