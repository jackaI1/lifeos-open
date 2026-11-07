import hashlib
import json

import pytest

from local_llm_judgment_eval.data import load_survey
from local_llm_judgment_eval.metrics import distribution_scores, repeat_consistency, soft_ece
from local_llm_judgment_eval.schema import parse_prediction

VALID = '{"A":0.1,"B":0.52,"C":0.36,"D":0.02}'


def test_accepts_valid_probability_object():
    assert parse_prediction(VALID).vector() == [0.1, 0.52, 0.36, 0.02]


@pytest.mark.parametrize(
    "raw",
    [
        "explanation " + VALID,
        "```json\n" + VALID + "\n```",
        '{"A":0.5,"B":0.5,"C":0,"D":0,"extra":0}',
        '{"A":0.5,"B":0.5,"C":0}',
        '{"A":true,"B":0,"C":0,"D":0}',
        '{"A":"0.5","B":0.5,"C":0,"D":0}',
        '{"A":-0.1,"B":0.7,"C":0.4,"D":0}',
        '{"A":1.1,"B":0,"C":0,"D":0}',
        '{"A":NaN,"B":0.5,"C":0.5,"D":0}',
        '{"A":Infinity,"B":0,"C":0,"D":0}',
        '{"A":0.1,"A":0.5,"B":0.5,"C":0,"D":0}',
        '{"A":0.2,"B":0.2,"C":0.2,"D":0.2}',
        "[]",
        "null",
    ],
)
def test_rejects_invalid_output_without_repairs(raw):
    with pytest.raises(ValueError):
        parse_prediction(raw)


def test_hand_computed_scores_and_irreducible_brier():
    p, q = [0.5, 0.5, 0, 0], [1, 0, 0, 0]
    result = distribution_scores(p, q)
    assert result["brier"] == pytest.approx(0.5)
    assert result["excess_brier"] == pytest.approx(0.5)
    assert result["total_variation"] == pytest.approx(0.5)
    result = distribution_scores([0.5, 0.5, 0, 0], [0.5, 0.5, 0, 0])
    assert result["brier"] == pytest.approx(0.5)
    assert result["excess_brier"] == 0
    assert result["js_divergence_bits"] == 0
    assert distribution_scores([1, 0, 0, 0], [0, 1, 0, 0])["js_divergence_bits"] == 1


def test_calibration_uses_soft_survey_frequencies_and_bin_boundaries():
    # Each row has one forecast per category, not an invented individual outcome.
    assert soft_ece([[0.5, 0.5, 0, 0]], [[1, 0, 0, 0]], bins=10) == 0.25
    assert soft_ece([[1, 0, 0, 0]], [[0, 1, 0, 0]], bins=10) == 0.5
    assert soft_ece([[0.25] * 4], [[0.25] * 4]) == 0


def test_consistency_means_pairwise_total_variation():
    assert repeat_consistency([[1, 0, 0, 0], [0, 1, 0, 0]]) == 1
    assert repeat_consistency([[0.25] * 4, [0.25] * 4]) == 0
    assert repeat_consistency([[0.25] * 4]) is None


@pytest.mark.parametrize(
    "p,q", [([0.5], [1, 0]), ([2, -1], [0.5, 0.5]), ([float("nan"), 0], [1, 0])]
)
def test_metrics_reject_invalid_vectors(p, q):
    with pytest.raises(ValueError):
        distribution_scores(p, q)


def test_survey_is_pinned_and_rounding_is_explicit(tmp_path):
    survey = load_survey()
    assert len(survey.cases) == 9
    assert survey.cases[0].target() == [0.1, 0.52, 0.36, 0.02]
    # Published percentages for accurate information sum to 101, not 100.
    assert survey.cases[1].target() == pytest.approx([33 / 101, 27 / 101, 40 / 101, 1 / 101])
    modified = tmp_path / "survey.json"
    modified.write_text("{}")
    with pytest.raises(ValueError, match="checksum"):
        load_survey(modified)
    # A checksum alone does not replace structural validation.
    broken = tmp_path / "bad.json"
    broken.write_text(json.dumps({"cases": []}))
    with pytest.raises(ValueError):
        load_survey(broken, expected_sha256=hashlib.sha256(broken.read_bytes()).hexdigest())


def test_uniform_predictions_do_not_cancel_errors_across_categories():
    assert soft_ece([[0.25] * 4], [[1, 0, 0, 0]]) == 0.375
