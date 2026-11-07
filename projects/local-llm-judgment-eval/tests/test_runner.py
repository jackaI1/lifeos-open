import json

import pytest

from local_llm_judgment_eval.data import load_survey
from local_llm_judgment_eval.runner import evaluate, make_prompt, write_reports


class StubBackend:
    metadata = {"backend": "stub", "model": "test-only"}
    server_pid = None

    def __init__(self, replies):
        self.replies = iter(replies)
        self.prompts = []

    def generate(self, prompt, schema, seed):
        self.prompts.append(prompt)
        reply = next(self.replies)
        if isinstance(reply, Exception):
            raise reply
        return reply


def test_retries_invalid_answer_preserves_raw_and_scores_only_valid(tmp_path):
    backend = StubBackend(["not json", '{"A":0.1,"B":0.52,"C":0.36,"D":0.02}'])
    survey = load_survey()
    report = evaluate(backend, survey, repeats=1, max_attempts=2, case_ids=["cncexc"])
    assert report["summary"]["accepted"] == 1
    assert report["summary"]["attempts"] == 2
    assert report["summary"]["excess_brier"] == 0
    assert report["runs"][0]["attempts"][0]["raw"] == "not json"
    assert report["runs"][0]["attempts"][0]["error_kind"] == "validation"
    assert report["runs"][0]["attempts"][1]["error"] is None
    assert "previous answer failed" in backend.prompts[1]
    assert report["runs"][0]["latency_s"] > 0
    assert report["runs"][0]["peak_client_rss_mib"] > 0
    assert report["summary"]["repeat_tv"] is None
    write_reports([report], tmp_path)
    assert json.loads((tmp_path / "results.json").read_text())["models"][0]["runs"]
    assert "Coverage" in (tmp_path / "comparison.md").read_text()


def test_all_rejected_is_visible_and_not_reported_as_zero_error(tmp_path):
    report = evaluate(
        StubBackend(["{}", "{}"]), load_survey(), repeats=2, max_attempts=1, case_ids=["cncexc"]
    )
    assert report["summary"]["coverage"] == 0
    assert report["summary"]["brier"] is None
    assert report["summary"]["soft_ece"] is None
    assert report["summary"]["rejected"] == 2
    write_reports([report], tmp_path)
    assert "n/a" in (tmp_path / "comparison.md").read_text()


def test_transport_errors_count_and_recover_without_hiding_latency():
    report = evaluate(
        StubBackend([OSError("offline"), '{"A":1,"B":0,"C":0,"D":0}']),
        load_survey(),
        repeats=1,
        max_attempts=2,
        case_ids=["cncexc"],
    )
    assert report["summary"]["accepted"] == 1
    assert report["runs"][0]["attempts"][0]["error_kind"] == "backend"


def test_repeat_consistency_is_per_question_and_coverage_is_explicit():
    # Opposite predictions for one case, identical predictions for the other.
    replies = [
        '{"A":1,"B":0,"C":0,"D":0}',
        '{"A":0,"B":1,"C":0,"D":0}',
        '{"A":1,"B":0,"C":0,"D":0}',
        '{"A":1,"B":0,"C":0,"D":0}',
    ]
    report = evaluate(
        StubBackend(replies),
        load_survey(),
        repeats=2,
        max_attempts=1,
        case_ids=["cncexc", "health"],
    )
    assert report["summary"]["repeat_tv"] == 0.5
    assert report["summary"]["repeat_case_coverage"] == 1
    assert [r["seed"] for r in report["runs"]] == [42, 43, 42, 43]


def test_prompt_has_persona_and_choices_but_no_targets():
    prompt = make_prompt(load_survey().cases[0])
    assert "age 18 or older" in prompt
    assert "Mostly excited" in prompt
    assert "0.52" not in prompt
    assert "percentages" not in prompt


@pytest.mark.parametrize(
    "kwargs", [{"repeats": 0}, {"max_attempts": 0}, {"case_ids": ["missing"]}, {"case_ids": []}]
)
def test_bad_run_configuration_rejected(kwargs):
    with pytest.raises(ValueError):
        evaluate(StubBackend([]), load_survey(), **kwargs)


def test_review_gate_and_audit_cover_retries_and_failures(tmp_path):
    import hashlib

    audit_path = tmp_path / "audit.jsonl"
    backend = StubBackend(
        ["bad", '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}', OSError("offline"), OSError("offline")]
    )
    report = evaluate(
        backend,
        load_survey(),
        repeats=2,
        max_attempts=2,
        case_ids=["cncexc"],
        confidence_threshold=0.4,
        audit_path=audit_path,
    )
    assert report["runs"][0]["review_required"]
    assert report["runs"][0]["released_prediction"] is None
    assert report["runs"][1]["review_required"]
    events = [json.loads(line) for line in audit_path.read_text().splitlines()]
    assert events == report["audit"]
    starts = [e for e in events if e["event"] == "started"]
    ends = [e for e in events if e["event"] == "completed"]
    assert len(starts) == len(ends) == len(backend.prompts) == 4
    assert {e["call_id"] for e in starts} == {e["call_id"] for e in ends}
    assert starts[0]["input_sha256"] == hashlib.sha256(backend.prompts[0].encode()).hexdigest()
    assert [e["outcome"] for e in ends] == ["validation", "valid", "backend", "backend"]
    assert report["category_checks"][0]["review_required"] == 2


def test_gate_releases_only_at_or_above_threshold():
    report = evaluate(
        StubBackend(['{"A":0.4,"B":0.2,"C":0.2,"D":0.2}']),
        load_survey(),
        repeats=1,
        case_ids=["cncexc"],
        confidence_threshold=0.4,
    )
    assert report["runs"][0]["released_prediction"] == [0.4, 0.2, 0.2, 0.2]
