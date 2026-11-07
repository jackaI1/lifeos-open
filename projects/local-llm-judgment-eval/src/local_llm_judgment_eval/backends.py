"""Local inference adapters. Heavy ML dependencies are loaded only when requested."""

import hashlib
import json
import time
from pathlib import Path
from typing import Protocol
from urllib.request import Request, urlopen

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_REVISION = "7ae557604adf67be50417f59c2c2f167def9a775"


class Backend(Protocol):
    metadata: dict
    server_pid: int | None

    def generate(self, prompt: str, schema: dict, seed: int) -> str: ...


def _request(url: str, payload: dict | None = None, timeout: float = 180) -> dict:
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(url, data=body, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as response:
        return json.load(response)


class OllamaBackend:
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
            "digest": tag["digest"],
            "temperature": temperature,
            "top_p": 0.9,
            "max_new_tokens": 192,
            "schema_guidance": True,
            "keep_alive": 0,
            "memory_scope": "client RSS + server tree RSS"
            if server_pid
            else "client RSS only; Ollama server memory unmeasured",
        }

    def generate(self, prompt: str, schema: dict, seed: int) -> str:
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
                    "num_predict": 192,
                    "num_ctx": 2048,
                },
            },
        )
        if not result.get("done") or not isinstance(result.get("response"), str):
            raise OSError("incomplete Ollama response")
        return result["response"]


class TransformersBackend:
    server_pid = None

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        revision: str = DEFAULT_REVISION,
        adapter: Path | None = None,
        device: str = "cpu",
        temperature: float = 0.7,
    ):
        import torch
        import transformers
        from transformers import AutoModelForCausalLM, AutoTokenizer

        if not revision or len(revision) != 40:
            raise ValueError("use an immutable 40-character Hugging Face commit revision")
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
            torch_dtype=torch.float32,
            trust_remote_code=False,
        ).to(device)
        if adapter:
            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, str(adapter))
        self.model.eval()
        self.device, self.temperature = device, temperature
        self.metadata = {
            "backend": "transformers",
            "model": model,
            "revision": revision,
            "adapter_sha256": training["adapter_sha256"] if adapter else None,
            "device": device,
            "dtype": "float32",
            "temperature": temperature,
            "top_p": 0.9,
            "max_new_tokens": 192,
            "schema_guidance": False,
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "load_latency_s": time.perf_counter() - start,
            "memory_scope": "client RSS; device allocation reported separately",
        }

    def generate(self, prompt: str, schema: dict, seed: int) -> str:
        import torch
        from transformers import set_seed

        set_seed(seed)
        inputs = self.tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            add_generation_prompt=True,
            tokenize=True,
            return_tensors="pt",
            return_dict=True,
        ).to(self.device)
        with torch.inference_mode():
            output = self.model.generate(
                **inputs,
                max_new_tokens=192,
                do_sample=self.temperature > 0,
                **({"temperature": self.temperature, "top_p": 0.9} if self.temperature > 0 else {}),
                pad_token_id=self.tokenizer.eos_token_id,
            )
        self.synchronize()
        return self.tokenizer.decode(
            output[0, inputs["input_ids"].shape[-1] :], skip_special_tokens=True
        ).strip()

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
