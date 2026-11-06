from copy import deepcopy

import pytest

from agent_tool_eval.dataset import load_tasks
from agent_tool_eval.runner import answer_matches, evaluate, run_task


class Sequence:
    """Scripted assistant at the model boundary; real runner and tools underneath."""

    def __init__(self, *messages):
        self.messages = iter(messages)
        self.histories = []

    def respond(self, messages, tools, seed):
        self.histories.append(deepcopy(messages))
        return next(self.messages)


def call(name="calculator", arguments=None):
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "function": {
                    "name": name,
                    "arguments": {"expression": "6 * 7"} if arguments is None else arguments,
                }
            }
        ],
    }


def task():
    return {
        "id": "test",
        "category": "calculator",
        "prompt": "Use the calculator for 6 * 7.",
        "expected_calls": [{"name": "calculator", "arguments": {"expression": "6 * 7"}}],
        "answer": {"kind": "number", "value": 42},
    }


def test_runner_executes_tools_and_returns_results_before_final():
    model = Sequence(call(), {"role": "assistant", "content": "42"})
    result = run_task(task(), model)
    assert result["passed"]
    assert model.histories[1][-1] == {"role": "tool", "tool_name": "calculator", "content": "42"}
    assert "expected_calls" not in str(model.histories)
    assert result["calls"][0]["result"] == 42


@pytest.mark.parametrize(
    "message,category",
    [
        (call(arguments={"expression": 42}), "argument_validity"),
        (call(arguments={"expression": "6 * 8"}), "argument_accuracy"),
        (call("ticket_get", {"id": "T-101"}), "tool_selection"),
        (call("invented", {}), "tool_selection"),
        ({"role": "assistant", "tool_calls": [None]}, "malformed_call"),
        ({"role": "assistant", "tool_calls": "calculator"}, "malformed_call"),
        (call(arguments='{"expression": "6 * 7"}'), "argument_validity"),
        ({"role": "assistant", "content": "41"}, "answer_accuracy"),
    ],
)
def test_failure_categories_are_independent_and_do_not_crash(message, category):
    model = Sequence(message, {"role": "assistant", "content": "42"})
    result = run_task(task(), model)
    assert not result["passed"]
    assert category in result["failures"]


def test_missing_calls_cannot_pass_with_a_correct_answer():
    result = run_task(task(), Sequence({"role": "assistant", "content": "42"}))
    assert result["answer_accuracy"]
    assert not result["tool_selection"]
    assert not result["passed"]


def test_loop_stops_at_budget():
    result = run_task(task(), Sequence(*[call() for _ in range(4)]), max_turns=3)
    assert "turn_limit" in result["failures"]
    assert len(result["calls"]) == 3


def test_calls_in_one_turn_are_bounded():
    message = call()
    message["tool_calls"] *= 20
    result = run_task(task(), Sequence(message), max_calls=2)
    assert len(result["calls"]) == 2
    assert "call_limit" in result["failures"]


def test_consistency_is_modal_share_of_trace_and_answer_not_accuracy():
    class Alternating:
        def respond(self, messages, tools, seed):
            return {"role": "assistant", "content": "42" if seed % 3 else "43"}

    report = evaluate([task()], Alternating(), repeats=3, seed=0)
    assert report["consistency"]["test"] == pytest.approx(2 / 3)
    assert report["summary"]["answer_accuracy"] == pytest.approx(2 / 3)
    assert report["summary"]["pass_rate"] == 0


@pytest.mark.parametrize(
    "answer,expected,ok",
    [
        ("42.0000001", {"kind": "number", "value": 42}, True),
        ("true", {"kind": "number", "value": 1}, False),
        ("NaN", {"kind": "number", "value": 42}, False),
        ("The answer is 42", {"kind": "number", "value": 42}, False),
        ("  In_Progress  ", {"kind": "text", "value": "in_progress"}, True),
        ('["T-101", "T-104"]', {"kind": "json", "value": ["T-101", "T-104"]}, True),
        ('["T-104", "T-101"]', {"kind": "json", "value": ["T-101", "T-104"]}, False),
    ],
)
def test_answer_matching_is_explicit_and_rejects_partial_matches(answer, expected, ok):
    assert answer_matches(answer, expected) is ok


def test_dataset_has_40_unique_tasks_and_hidden_answers():
    tasks = load_tasks()
    assert len(tasks) == len({t["id"] for t in tasks}) == 40
    assert {t["category"] for t in tasks} == {
        "calculator",
        "file_lookup",
        "tickets",
        "multi_step",
        "no_tool",
    }


def test_invalid_dataset_is_rejected_early(tmp_path):
    path = tmp_path / "bad.json"
    path.write_text('[{"id": "test"}]')
    with pytest.raises(ValueError, match="dataset"):
        load_tasks(path)


def test_huge_numeric_answer_is_incorrect_without_aborting_later_runs():
    model = Sequence(
        {"role": "assistant", "content": "1" + "0" * 400}, {"role": "assistant", "content": "42"}
    )
    report = evaluate([task()], model, repeats=2)
    assert len(report["runs"]) == 2
    assert not report["runs"][0]["answer_accuracy"]
    assert report["runs"][1]["answer_accuracy"]


def test_deep_json_answer_and_nested_tool_message_do_not_crash():
    content = "[" * 12000 + "0" + "]" * 12000
    result = run_task(task(), Sequence({"role": "assistant", "content": content}))
    assert not result["answer_accuracy"]
    nested = {}
    for _ in range(1500):
        nested = {"value": nested}
    result = run_task(task(), Sequence(call(arguments=nested)))
    assert "malformed_response" in result["failures"]


def test_text_consistency_ignores_case_for_json_strings_and_plain_text():
    no_tool = load_tasks()[36]
    report = evaluate(
        [no_tool],
        Sequence(
            {"role": "assistant", "content": "ready"}, {"role": "assistant", "content": '"READY"'}
        ),
        repeats=2,
    )
    assert report["summary"]["pass_rate"] == 1
    assert report["summary"]["consistency"] == 1


def test_json_matcher_requires_valid_json_even_for_string_targets():
    expected = {"kind": "json", "value": "ready"}
    assert not answer_matches("ready", expected)
    assert answer_matches('"ready"', expected)
