"""Real Transformers CPU inference with a small OpenAI-compatible surface.

This is a portable fallback, not a substitute measurement of vLLM throughput.
"""

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def serve(model_path, name, port):
    torch.set_num_threads(2)
    tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(model_path, local_files_only=True).eval()
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/v1/models":
                self.respond(200, {"data": [{"id": name}], "object": "list"})
            else:
                self.respond(404, {"error": "unknown endpoint"})

        def do_POST(self):
            try:
                if self.path != "/v1/completions":
                    return self.respond(404, {"error": "unknown endpoint"})
                size = int(self.headers.get("Content-Length", 0))
                if not 0 < size <= 65536:
                    raise ValueError("Request must be 1..65536 bytes")
                request = json.loads(self.rfile.read(size))
                budget = request.get("max_tokens", 96)
                if (
                    request.get("model") != name
                    or not isinstance(request.get("prompt"), str)
                    or type(budget) is not int
                    or not 1 <= budget <= 512
                    or request.get("stream", False)
                    or request.get("temperature", 0) != 0
                ):
                    raise ValueError(
                        "Only this model, text prompts and greedy non-streaming are supported"
                    )
                with lock, torch.inference_mode():
                    ids = tokenizer(
                        request["prompt"], return_tensors="pt", add_special_tokens=False
                    )
                    output = model.generate(
                        **ids,
                        max_new_tokens=budget,
                        do_sample=False,
                        pad_token_id=tokenizer.eos_token_id,
                    )
                    generated = output[0, ids["input_ids"].shape[1] :]
                self.respond(
                    200,
                    {
                        "model": name,
                        "choices": [
                            {
                                "text": tokenizer.decode(generated, skip_special_tokens=True),
                                "finish_reason": "length",
                            }
                        ],
                        "usage": {
                            "prompt_tokens": ids["input_ids"].shape[1],
                            "completion_tokens": len(generated),
                        },
                    },
                )
            except (ValueError, KeyError, TypeError) as error:
                self.respond(400, {"error": str(error)})
            except Exception:
                self.respond(500, {"error": "generation failed"})

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    serve(args.model, args.name, args.port)
