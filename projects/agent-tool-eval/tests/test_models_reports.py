import csv
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from agent_tool_eval.dataset import load_tasks
from agent_tool_eval.models import OllamaModel, ScriptedModel
from agent_tool_eval.reports import write_reports
from agent_tool_eval.runner import ModelError, evaluate


@contextmanager
def endpoint(tmp_path, responses):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            response = responses.pop(0)
            status, payload = response if isinstance(response, tuple) else (200, response)
            self.send_response(status)
            self.end_headers()
            self.wfile.write(
                payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            )

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = Thread(target=server.serve_forever, daemon=True)
    port = server.server_port
    (tmp_path / "server-owner.json").write_text(
        json.dumps(
            {
                "owner": "test_models_reports.endpoint",
                "pid": os.getpid(),
                "process_start": subprocess.check_output(
                    ["ps", "-p", str(os.getpid()), "-o", "lstart="], text=True
                ).strip(),
                "port": port,
                "cleanup": "fixture finally: server.shutdown(); server.server_close(); thread.join()",
            }
        )
    )
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()
        assert server.fileno() == -1


def test_http_adapter_drives_real_tool_roundtrip_and_reports(tmp_path):
    task = load_tasks()[0]
    responses = [
        {
            "message": {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"function": {"name": "calculator", "arguments": {"expression": "24 * 12.5"}}}
                ],
            }
        },
        {"message": {"role": "assistant", "content": "300"}},
    ]
    with endpoint(tmp_path, responses) as (url, requests):
        report = evaluate([task], OllamaModel(url, "test-model", temperature=0.2), repeats=1)
    assert report["summary"]["pass_rate"] == 1
    assert report["summary"]["consistency"] is None
    assert requests[0]["stream"] is False
    assert requests[0]["options"] == {"seed": 0, "temperature": 0.2, "num_predict": 512}
    assert requests[0]["tools"][0]["function"]["name"] == "file_lookup"
    assert requests[1]["messages"][-1]["content"] == "300.0"
    assert "expected_calls" not in json.dumps(requests)
    write_reports(report, tmp_path / "report")
    with (tmp_path / "report/runs.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 1 and rows[0]["passed"] == "True"
    assert "N/A" in (tmp_path / "report/report.md").read_text()
    assert json.loads((tmp_path / "report/traces.json").read_text())["runs"][0]["answer"] == "300"


@pytest.mark.parametrize(
    "response,category",
    [
        (b"not JSON", "malformed_response"),
        ({"error": "model not found"}, "endpoint_error"),
        ({"message": None}, "malformed_response"),
        ((503, {"error": "unavailable"}), "endpoint_error"),
    ],
)
def test_http_errors_become_failed_runs_not_false_passes(tmp_path, response, category):
    with endpoint(tmp_path, [response, response]) as (url, _):
        report = evaluate(load_tasks()[:1], OllamaModel(url, "test-model"), repeats=2)
    assert report["summary"]["pass_rate"] == 0
    assert report["summary"]["consistency"] == 0
    assert category in report["runs"][0]["failures"]


def test_connection_failure_is_reported_without_exposing_details(monkeypatch):
    from urllib.error import URLError

    def fail(*args, **kwargs):
        raise URLError("private connection diagnostic")

    monkeypatch.setattr("agent_tool_eval.models.urlopen", fail)
    with pytest.raises(ModelError, match="request failed") as exc:
        OllamaModel("http://localhost:1", "test").respond([], [], 0)
    assert "private" not in str(exc.value)


def test_all_reference_tasks_replay_through_actual_tools():
    tasks = load_tasks()
    report = evaluate(tasks, ScriptedModel(tasks), repeats=3)
    assert report["summary"]["runs"] == 120
    assert report["summary"]["pass_rate"] == 1
    assert report["summary"]["consistency"] == 1
    # Independent known results catch reference mistakes even though the fake uses gold answers.
    runs = report["runs"]
    assert runs[0]["calls"][0]["result"] == 300
    assert runs[96]["calls"][1]["result"] == 30
    assert runs[102]["calls"][1]["result"]["status"] == "closed"
    assert runs[105]["calls"][0]["result"] == {"error": "not_found"}


def test_mixed_profile_has_categorized_failures_in_markdown_and_csv(tmp_path):
    tasks = load_tasks()
    report = evaluate(tasks, ScriptedModel(tasks, profile="mixed"), repeats=3)
    assert 0 < report["summary"]["pass_rate"] < 1
    assert 0 < report["summary"]["consistency"] < 1
    write_reports(report, tmp_path)
    text = (tmp_path / "report.md").read_text()
    for category in ("tool_selection", "argument_validity", "argument_accuracy", "answer_accuracy"):
        assert category in text
    with (tmp_path / "runs.csv").open() as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 120
    assert any("argument_validity" in r["failures"] for r in rows)


def test_cli_generates_reports_and_enforces_threshold(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "agent_tool_eval",
            "--backend",
            "scripted",
            "--scripted-profile",
            "mixed",
            "--out",
            str(tmp_path),
            "--fail-under",
            "1",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert (tmp_path / "runs.csv").is_file()
    assert "120 runs" in result.stdout


@pytest.mark.parametrize(
    "option,value",
    [
        ("--repeats", "0"),
        ("--timeout", "0"),
        ("--temperature", "nan"),
        ("--max-turns", "0"),
        ("--fail-under", "2"),
    ],
)
def test_cli_rejects_invalid_configuration(tmp_path, option, value):
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "agent_tool_eval",
            "--backend",
            "scripted",
            "--out",
            str(tmp_path),
            option,
            value,
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert not (tmp_path / "runs.csv").exists()


def test_thinking_can_be_disabled_for_small_model_budgets(tmp_path):
    with endpoint(tmp_path, [{"message": {"role": "assistant", "content": "ready"}}]) as (
        url,
        requests,
    ):
        model = OllamaModel(url, "qwen3:0.6b", think=False)
        model.respond([], [], 0)
    assert requests[0]["think"] is False


def test_gold_answers_agree_with_executed_fixture_records():
    """Catch stale/wrong references that a gold-answer scripted model alone cannot catch."""
    from agent_tool_eval.tools import Sandbox

    tasks = load_tasks()
    fields = [
        "sensor_count",
        "spare_count",
        "unit_cost",
        "inspection_day",
        "interval_days",
        "max_temperature_c",
        "min_pressure_kpa",
        "sample_count",
        "revision",
        "owner",
        "status",
        "status",
        "title",
        "priority",
    ]
    for index, task in enumerate(tasks[:36]):
        sandbox = Sandbox()
        outputs = [sandbox.execute(c["name"], c["arguments"]) for c in task["expected_calls"]]
        last = outputs[-1]
        if index < 12 or index in (32, 33):
            actual = last
        elif index < 26:
            actual = last[fields[index - 12]]
        elif index < 30:
            actual = [row["id"] for row in last]
        elif index in (30, 34):
            actual = last["status"]
        elif index == 31:
            actual = last["error"]
        else:
            actual = last["revision"]
        assert actual == task["answer"]["value"], task["id"]
    assert [t["answer"]["value"] for t in tasks[36:]] == ["ready", "blue", 7, "paused"]


def test_truncated_http_response_is_an_endpoint_failure(monkeypatch):
    from http.client import IncompleteRead

    class BrokenResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            raise IncompleteRead(b'{"message":', 100)

    monkeypatch.setattr("agent_tool_eval.models.urlopen", lambda *a, **k: BrokenResponse())
    report = evaluate(load_tasks()[:1], OllamaModel("http://localhost:1", "test"), repeats=2)
    assert report["summary"]["pass_rate"] == 0
    assert report["summary"]["consistency"] == 0
    assert "endpoint_error" in report["runs"][0]["failures"]


def test_deep_http_json_is_a_malformed_response(tmp_path):
    body = b'{"message":' + b"[" * 12000 + b"0" + b"]" * 12000 + b"}"
    with endpoint(tmp_path, [body]) as (url, _):
        report = evaluate(load_tasks()[:1], OllamaModel(url, "test"), repeats=1)
    assert "malformed_response" in report["runs"][0]["failures"]
