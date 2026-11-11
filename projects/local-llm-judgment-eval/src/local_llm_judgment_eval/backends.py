"""Local inference adapters. Heavy ML dependencies are loaded only when requested.

Every backend returns the same kind of text for the same prompt and records the same timing
fields in ``last_timing`` after each call, so Ollama, Transformers and vLLM can be compared on
the same typed-probability tasks:

- ``ttft_s``: seconds from sending the request to the first generated token (Ollama reports
  load plus prompt processing, because it unloads the model after every request).
- ``completion_tokens``: tokens the model generated for this call.
- ``generation_s``: seconds spent generating after the first token.
"""

import hashlib
import json
import re
import time
from pathlib import Path
from typing import Protocol
from urllib.request import Request, urlopen

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"
MAX_NEW_TOKENS = 192
TORCH_DTYPES = ("float32", "float16", "bfloat16")


class Backend(Protocol):
    metadata: dict
    server_pid: int | None
    last_timing: dict | None

    def generate(self, prompt: str, schema: dict, seed: int) -> str: ...

    def generate_timed(self, prompt: str, schema: dict, seed: int) -> tuple[str, dict]: ...


def _request(url: str, payload: dict | None = None, timeout: float = 180) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as response:
        return json.load(response)


def _check_revision(revision: str) -> None:
    if not revision or not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("use an immutable 40-character Hugging Face commit revision")


class _TimedBackend:
    """generate() returns text and leaves its timing in last_timing (sequential callers).

    generate_timed() returns both, so concurrent callers never share a timing record.
    """

    last_timing = None

    def generate(self, prompt: str, schema: dict, seed: int) -> str:
        text, self.last_timing = self.generate_timed(prompt, schema, seed)
        return text


class OllamaBackend(_TimedBackend):
    def __init__(
        self,
        model: str,
        *,
        url: str = "http://127.0.0.1:11434",
        server_pid: int | None = None,
        temperature: float = 0.7,
    ):
        self.model, self.url = model, url.rstrip("/")
        self.server_pid, self.temperature = server_pid, temperature
        tags = _request(self.url + "/api/tags")["models"]
        tag = next((m for m in tags if m["name"] == model), None)
        if tag is None:
            raise ValueError(f"model {model} not installed; run ollama pull {model}")
        self.metadata = {
            "backend": "ollama",
            "model": model,
            "url": self.url,
            "digest": tag["digest"],
            "temperature": temperature,
            "top_p": 0.9,
            "max_new_tokens": MAX_NEW_TOKENS,
            "schema_guidance": True,
            "keep_alive": 0,
            "memory_scope": "client RSS + server tree RSS"
            if server_pid
            else "client RSS only; Ollama server memory unmeasured",
        }

    def generate_timed(self, prompt: str, schema: dict, seed: int) -> tuple[str, dict]:
        result = _request(
            self.url + "/api/generate",
            {
                "model": self.model,
                "prompt": prompt,
                "format": schema,
                "stream": False,
                "keep_alive": 0,
                "options": {
                    "seed": seed,
                    "temperature": self.temperature,
                    "top_p": 0.9,
                    "num_predict": MAX_NEW_TOKENS,
                    "num_ctx": 2048,
                },
            },
        )
        if not result.get("done") or not isinstance(result.get("response"), str):
            raise OSError("incomplete Ollama response")
        # Durations are nanoseconds. Model load and prompt processing both happen before the
        # first token, so they are included in TTFT.
        before_first = (
            result.get("load_duration", 0) + result.get("prompt_eval_duration", 0)
        ) / 1e9
        timing = {
            "ttft_s": before_first,
            "completion_tokens": int(result.get("eval_count", 0)),
            "generation_s": result.get("eval_duration", 0) / 1e9,
        }
        return result["response"], timing


class VLLMBackend(_TimedBackend):
    """OpenAI-compatible vLLM server, streamed so that time to first token can be measured.

    Start the server yourself with the same model and revision, for example:
    ``vllm serve Qwen/Qwen2.5-0.5B-Instruct --revision <40-char SHA> --port 8000``.
    The backend refuses to run unless the server lists the requested model ID.
    """

    server_pid = None
    thread_safe = True  # the HTTP server batches concurrent requests itself

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        revision: str = DEFAULT_REVISION,
        url: str = "http://127.0.0.1:8000",
        temperature: float = 0.7,
    ):
        _check_revision(revision)
        self.model, self.url = model, url.rstrip("/")
        self.temperature = temperature
        served = [m.get("id") for m in _request(self.url + "/v1/models").get("data", [])]
        if model not in served:
            raise ValueError(
                f"vLLM server does not list {model}; serve it with --revision {revision}"
            )
        try:
            version = _request(self.url + "/version").get("version")
        except OSError:
            version = None
        self.metadata = {
            "backend": "vllm",
            "model": model,
            "revision": revision,
            "url": self.url,
            "served_models": served,
            "vllm_version": version,
            "temperature": temperature,
            "top_p": 0.9,
            "max_new_tokens": MAX_NEW_TOKENS,
            "schema_guidance": True,
            "memory_scope": "client RSS only; vLLM server GPU memory unmeasured",
        }

    def generate_timed(self, prompt: str, schema: dict, seed: int) -> tuple[str, dict]:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
            "top_p": 0.9,
            "max_tokens": MAX_NEW_TOKENS,
            "seed": seed,
            "stream": True,
            "stream_options": {"include_usage": True},
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "typed_probabilities", "schema": schema, "strict": True},
            },
        }
        req = Request(
            self.url + "/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        pieces, first_token, usage = [], None, None
        start = time.perf_counter()
        with urlopen(req, timeout=180) as response:
            for raw in response:
                line = raw.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("usage"):
                    usage = event["usage"]
                for choice in event.get("choices", []):
                    text = (choice.get("delta") or {}).get("content") or ""
                    if text:
                        first_token = first_token or time.perf_counter()
                        pieces.append(text)
        if first_token is None:
            raise OSError("vLLM returned no generated tokens")
        timing = {
            "ttft_s": first_token - start,
            "completion_tokens": int(usage["completion_tokens"]) if usage else len(pieces),
            "generation_s": time.perf_counter() - first_token,
        }
        return "".join(pieces), timing


class TransformersBackend(_TimedBackend):
    server_pid = None
    thread_safe = False  # one in-process model; generate() must not run concurrently

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        revision: str = DEFAULT_REVISION,
        adapter: Path | None = None,
        device: str = "cpu",
        dtype: str = "float32",
        temperature: float = 0.7,
    ):
        import torch
        import transformers
        from transformers import AutoModelForCausalLM, AutoTokenizer

        _check_revision(revision)
        if dtype not in TORCH_DTYPES:
            raise ValueError(f"dtype must be one of {', '.join(TORCH_DTYPES)}")
        torch_dtype = getattr(torch, dtype)
        if adapter:
            training = json.loads((adapter / "training.json").read_text())
            if training["base_model"] != model or training["revision"] != revision:
                raise ValueError("adapter base model/revision mismatch")
            actual_hash = hashlib.sha256(
                (adapter / "adapter_model.safetensors").read_bytes()
            ).hexdigest()
            if actual_hash != training["adapter_sha256"]:
                raise ValueError("adapter checksum mismatch")
        start = time.perf_counter()
        torch.set_num_threads(4)
        self.tokenizer = AutoTokenizer.from_pretrained(model, revision=revision)
        self.model = AutoModelForCausalLM.from_pretrained(
            model,
            revision=revision,
            dtype=torch_dtype,
            trust_remote_code=False,
        ).to(device)
        if adapter:
            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, str(adapter))
        self.model.eval()
        self.device, self.temperature, self.dtype = device, temperature, dtype
        self.metadata = {
            "backend": "transformers",
            "model": model,
            "revision": revision,
            "adapter_sha256": training["adapter_sha256"] if adapter else None,
            "device": device,
            "dtype": dtype,
            "temperature": temperature,
            "top_p": 0.9,
            "max_new_tokens": MAX_NEW_TOKENS,
            "schema_guidance": False,
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "load_latency_s": time.perf_counter() - start,
            "memory_scope": "client RSS; device allocation reported separately",
        }

    def _generation_kwargs(self) -> dict:
        return {
            "max_new_tokens": MAX_NEW_TOKENS,
            "do_sample": self.temperature > 0,
            **({"temperature": self.temperature, "top_p": 0.9} if self.temperature > 0 else {}),
            "pad_token_id": self.tokenizer.eos_token_id,
        }

    def generate_timed(self, prompt: str, schema: dict, seed: int) -> tuple[str, dict]:
        import torch
        from transformers import LogitsProcessor, LogitsProcessorList, set_seed

        class FirstTokenClock(LogitsProcessor):
            """Called once per decoding step; the first call happens after prompt processing."""

            first_call = None

            def __call__(self, input_ids, scores):
                if self.first_call is None:
                    self.first_call = time.perf_counter()
                return scores

        set_seed(seed)
        inputs = self.tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True,
            tokenize=True,
            return_tensors="pt",
            return_dict=True,
        )
        inputs.pop("token_type_ids", None)  # causal LMs do not take it
        inputs = inputs.to(self.device)
        clock = FirstTokenClock()
        start = time.perf_counter()
        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                **self._generation_kwargs(),
                logits_processor=LogitsProcessorList([clock]),
            )
        self.synchronize()
        end = time.perf_counter()
        generated = output[0, inputs["input_ids"].shape[-1] :]
        # Padding uses the EOS id, so counting non-EOS tokens gives the real completion length.
        completion_tokens = int((generated != self.tokenizer.eos_token_id).sum())
        first = clock.first_call or end
        timing = {
            "ttft_s": first - start,
            "completion_tokens": completion_tokens,
            "generation_s": end - first,
        }
        return self.tokenizer.decode(generated, skip_special_tokens=True).strip(), timing

    def generate_batch(self, prompts: list[str], seed: int) -> tuple[list[str], list[int]]:
        """Left-padded batch generation used by the profiler.

        Returns one text and one generated-token count per prompt.
        """
        import torch
        from transformers import set_seed

        set_seed(seed)
        self.tokenizer.padding_side = "left"
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        texts = [
            self.tokenizer.apply_chat_template(
                [{"role": "user", "content": p}], add_generation_prompt=True, tokenize=False
            )
            for p in prompts
        ]
        inputs = self.tokenizer(
            texts, return_tensors="pt", padding=True, return_token_type_ids=False
        ).to(self.device)
        with torch.inference_mode():
            output = self.model.generate(**inputs, **self._generation_kwargs())
        self.synchronize()
        new_tokens = output[:, inputs["input_ids"].shape[-1] :]
        eos = self.tokenizer.eos_token_id
        texts = [self.tokenizer.decode(row, skip_special_tokens=True).strip() for row in new_tokens]
        counts = [int((row != eos).sum()) for row in new_tokens]
        return texts, counts

    def synchronize(self):
        import torch

        if self.device.startswith("cuda"):
            torch.cuda.synchronize()
        elif self.device == "mps":
            torch.mps.synchronize()

    def device_memory_mib(self) -> float | None:
        import torch

        if self.device.startswith("cuda"):
            return torch.cuda.max_memory_allocated() / 2**20
        if self.device == "mps":
            return torch.mps.current_allocated_memory() / 2**20
        return None
