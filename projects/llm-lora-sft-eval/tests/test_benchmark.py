import json
import threading
import urllib.error
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from llm_eval.benchmark import aggregate, benchmark, completion

TARGET = {"name": "Fiction", "member_id": "M1", "region": None, "status": "active"}


@contextmanager
def endpoint(payload=None, status=200):
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            calls.append(
                (self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            )
            self.send_response(status)
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    payload
                    if payload is not None
                    else {
                        "choices": [{"text": json.dumps(TARGET)}],
                        "usage": {"completion_tokens": 4},
                    }
                ).encode()
            )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()


def test_real_http_contract_warmups_and_order():
    rows = [{"id": str(i), "target": TARGET} for i in range(4)]
    with endpoint() as (url, calls):
        metrics, records = benchmark(
            url, "merged", rows, ["prompt"] * 4, max_tokens=12, concurrency=2, warmup=2
        )
    assert len(calls) == 6
    assert calls[0][0] == "/v1/completions"
    assert calls[0][1] == {
        "model": "merged",
        "prompt": "prompt",
        "max_tokens": 12,
        "temperature": 0,
        "seed": 42,
        "stream": False,
        "add_special_tokens": False,
    }
    assert [r["id"] for r in records] == ["0", "1", "2", "3"]
    assert metrics["output_tokens"] == 16
    assert metrics["exact_match"] == 1
    assert metrics["latency_p95_s"] >= metrics["latency_p50_s"] > 0


def test_throughput_uses_wall_time_and_failures_get_zero_credit():
    records = [
        {"latency_s": 1, "completion_tokens": 5, "scores": {"exact_match": 1}},
        {"latency_s": 3, "completion_tokens": 7, "scores": {"exact_match": 0}},
        {"error": "HTTPError", "scores": {"exact_match": 0}},
    ]
    metrics = aggregate(records, 2)
    assert metrics["output_tokens_per_s"] == 6  # Not 12 / sum(request latency).
    assert metrics["requests_per_s"] == 1
    assert metrics["latency_p50_s"] == 2
    assert metrics["latency_p95_s"] == pytest.approx(2.9)
    assert metrics["exact_match"] == pytest.approx(1 / 3)
    assert metrics["success_rate"] == pytest.approx(2 / 3)


@pytest.mark.parametrize("tokens", [None, 0, -1, True, "12", 1.5])
def test_reject_missing_or_invalid_token_counts(tokens):
    with endpoint({"choices": [{"text": "answer"}], "usage": {"completion_tokens": tokens}}) as (
        url,
        _,
    ):
        with pytest.raises(ValueError):
            completion(url, "base", "input", 8)


def test_http_error_is_visible_and_warmup_errors_abort():
    with endpoint(status=503) as (url, _):
        rows = [{"id": "1", "target": TARGET}]
        metrics, records = benchmark(url, "base", rows, ["input"], warmup=0)
        assert metrics["failed_requests"] == 1
        assert metrics["output_tokens_per_s"] == 0
        assert metrics["exact_match"] == 0
        assert "503" in records[0]["error"]
        with pytest.raises(urllib.error.HTTPError):
            benchmark(url, "base", rows, ["input"])


@pytest.mark.parametrize(
    "kwargs", [{"concurrency": 0}, {"max_tokens": 0}, {"warmup": -1}, {"timeout": 0}]
)
def test_invalid_benchmark_inputs(kwargs):
    with pytest.raises(ValueError):
        benchmark("http://unused", "base", [{"id": "1"}], ["input"], **kwargs)
