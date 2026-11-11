import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from local_llm_judgment_eval.backends import OllamaBackend, VLLMBackend
from local_llm_judgment_eval.data import load_survey
from local_llm_judgment_eval.runner import batch_throughput, evaluate
from local_llm_judgment_eval.schema import Prediction

MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
REVISION = "a" * 40
REPLY = '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}'


def _sse(text_pieces, usage_tokens):
    lines = []
    for piece in text_pieces:
        event = {"choices": [{"delta": {"content": piece}}]}
        lines.append(f"data: {json.dumps(event)}\n\n")
    lines.append(
        f"data: {json.dumps({'choices': [], 'usage': {'completion_tokens': usage_tokens}})}\n\n"
    )
    lines.append("data: [DONE]\n\n")
    return "".join(lines).encode()


@pytest.fixture
def vllm_stub():
    """Stands in for `vllm serve`: OpenAI-compatible model list, version and streamed chat."""
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _send(self, body, content_type="application/json"):
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/v1/models":
                self._send(json.dumps({"data": [{"id": MODEL}]}).encode())
            elif self.path == "/version":
                self._send(json.dumps({"version": "0.0-test"}).encode())
            else:
                self.send_error(404)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body)
            assert body["stream"] is True
            assert body["response_format"]["type"] == "json_schema"
            assert body["seed"] >= 0
            self._send(_sse([REPLY[:10], REPLY[10:]], usage_tokens=9), "text/event-stream")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", seen
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_vllm_streams_text_and_reports_time_to_first_token(vllm_stub):
    url, seen = vllm_stub
    backend = VLLMBackend(MODEL, revision=REVISION, url=url, temperature=0.7)
    text, timing = backend.generate_timed("survey prompt", Prediction.model_json_schema(), 5)
    assert text == REPLY
    assert Prediction.model_validate_json(text).A == 0.25
    assert timing["completion_tokens"] == 9
    assert timing["ttft_s"] >= 0
    assert timing["generation_s"] >= 0
    assert seen[0]["model"] == MODEL
    assert seen[0]["response_format"]["json_schema"]["strict"] is True
    assert backend.metadata["vllm_version"] == "0.0-test"
    assert backend.metadata["revision"] == REVISION


def test_generate_sets_last_timing_for_sequential_callers(vllm_stub):
    url, _ = vllm_stub
    backend = VLLMBackend(MODEL, revision=REVISION, url=url)
    assert backend.generate("p", {}, 1) == REPLY
    assert backend.last_timing["completion_tokens"] == 9


def test_rejects_non_commit_revision_and_unserved_model(vllm_stub):
    url, _ = vllm_stub
    with pytest.raises(ValueError, match="40-character"):
        VLLMBackend(MODEL, revision="main", url=url)
    with pytest.raises(ValueError, match="does not list"):
        VLLMBackend("other/model", revision=REVISION, url=url)


def test_full_evaluation_and_concurrent_batch_throughput(vllm_stub):
    url, _ = vllm_stub
    backend = VLLMBackend(MODEL, revision=REVISION, url=url)
    survey = load_survey()
    report = evaluate(backend, survey, repeats=1, max_attempts=1, case_ids=["cncexc", "health"])
    assert report["summary"]["coverage"] == 1
    assert report["summary"]["mean_ttft_s"] >= 0
    assert report["summary"]["tokens_per_s"] > 0
    throughput = batch_throughput(backend, survey, concurrency=3)
    assert throughput["requests"] == len(survey.cases)
    assert throughput["concurrency"] == 3
    assert throughput["requests_per_s"] > 0
    assert throughput["completion_tokens"] == 9 * len(survey.cases)


def test_ollama_timing_is_taken_from_its_duration_fields():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            body = json.dumps({"models": [{"name": "test:latest", "digest": "sha256:x"}]})
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body.encode())

        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            body = json.dumps(
                {
                    "response": REPLY,
                    "done": True,
                    "load_duration": 2_000_000_000,
                    "prompt_eval_duration": 500_000_000,
                    "eval_duration": 1_000_000_000,
                    "eval_count": 12,
                }
            )
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body.encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        backend = OllamaBackend("test:latest", url=f"http://127.0.0.1:{server.server_port}")
        text, timing = backend.generate_timed("p", {}, 1)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert text == REPLY
    assert timing == {"ttft_s": 2.5, "completion_tokens": 12, "generation_s": 1.0}
