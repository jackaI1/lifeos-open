import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from local_llm_judgment_eval.backends import OllamaBackend
from local_llm_judgment_eval.schema import Prediction, parse_prediction


@pytest.fixture
def ollama_server():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            payload = {"models": [{"name": "test:latest", "digest": "sha256:example"}]}
            self.send_response(200)
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode())

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            self.send_response(200)
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"response": '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}', "done": True}
                ).encode()
            )

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_ollama_sends_schema_seed_and_returns_only_generated_text(ollama_server):
    url, requests = ollama_server
    backend = OllamaBackend("test:latest", url=url)
    raw = backend.generate("survey prompt", Prediction.model_json_schema(), 123)
    assert parse_prediction(raw).vector() == [0.25] * 4
    assert requests[0]["format"]["additionalProperties"] is False
    assert requests[0]["options"]["seed"] == 123
    assert requests[0]["options"]["temperature"] == 0.7
    assert requests[0]["stream"] is False
    assert requests[0]["keep_alive"] == 0
    assert backend.metadata["digest"] == "sha256:example"
