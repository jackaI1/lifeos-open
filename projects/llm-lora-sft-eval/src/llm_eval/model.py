"""Shared model loading and identical inference/training prompt construction."""

import platform
from dataclasses import asdict, dataclass

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

SYSTEM = (
    'Extract the member record as JSON with exactly these keys: "name", "member_id", '
    '"region", "status". Use null for a field marked not provided. '
    "Ignore unrelated clerk notes. Return only JSON, with no explanation."
)


@dataclass
class Config:
    model: str = "HuggingFaceTB/SmolLM2-135M-Instruct"
    revision: str = "12fd25f77366fa6b3b4b768ec3050bf629380bac"
    mode: str = "lora"
    device: str = "cpu"
    precision: str = "auto"
    seed: int = 42
    steps: int = 80
    batch_size: int = 2
    accumulation: int = 4
    max_length: int = 256
    learning_rate: float = 0.0005
    rank: int = 8
    alpha: int = 16
    threads: int = 2
    gradient_checkpointing: bool = True

    def validate(self):
        if self.mode not in ("lora", "qlora") or self.device not in ("cpu", "cuda"):
            raise ValueError("Mode must be lora/qlora; device must be cpu/cuda")
        if self.precision not in ("auto", "fp32", "fp16", "bf16"):
            raise ValueError("Unknown precision")
        if (
            any(
                v < 1
                for v in (
                    self.steps,
                    self.batch_size,
                    self.accumulation,
                    self.max_length,
                    self.rank,
                    self.alpha,
                    self.threads,
                )
            )
            or self.learning_rate <= 0
        ):
            raise ValueError("Training sizes and learning rate must be positive")
        if self.device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA requested but unavailable; use cpu for a smoke test")
        if self.device == "cpu" and self.precision in ("fp16", "bf16"):
            raise ValueError("CPU path uses fp32; mixed precision is enabled on CUDA")
        if self.mode == "qlora" and platform.system() == "Darwin":
            raise ValueError(
                "Pinned bitsandbytes QLoRA needs Linux/Windows CPU or CUDA; see docs/runs.md"
            )
        return self

    def dtype(self):
        if self.precision == "fp32" or self.device == "cpu":
            return torch.float32
        if self.precision == "bf16" or (
            self.precision == "auto" and torch.cuda.is_bf16_supported()
        ):
            return torch.bfloat16
        return torch.float16

    def dict(self):
        return asdict(self)


def load_model(config):
    config.validate()
    kwargs = {
        "revision": config.revision,
        "torch_dtype": config.dtype(),
        "attn_implementation": "eager",
        "trust_remote_code": False,
    }
    if config.mode == "qlora":
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=config.dtype(),
        )
        kwargs["device_map"] = {"": "cpu" if config.device == "cpu" else "cuda:0"}
    model = AutoModelForCausalLM.from_pretrained(config.model, **kwargs)
    if config.mode == "lora":
        model.to(config.device)
    tokenizer = AutoTokenizer.from_pretrained(config.model, revision=config.revision)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    return model, tokenizer


def prompt_ids(tokenizer, text):
    return tokenizer.apply_chat_template(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
        tokenize=True,
        add_generation_prompt=True,
    )


def encode_row(tokenizer, row, max_length):
    from llm_eval.data import canonical

    prefix = prompt_ids(tokenizer, row["input"])
    answer = tokenizer.encode(canonical(row["target"]), add_special_tokens=False)
    answer += [tokenizer.eos_token_id]
    ids = prefix + answer
    if len(ids) > max_length:
        raise ValueError(
            f"Row {row['id']} needs {len(ids)} tokens; raise max_length, never truncate labels"
        )
    return {
        "input_ids": ids,
        "attention_mask": [1] * len(ids),
        "labels": [-100] * len(prefix) + answer,
    }


class CompletionCollator:
    def __init__(self, pad_token_id):
        self.pad_token_id = pad_token_id

    def __call__(self, rows):
        width = max(len(r["input_ids"]) for r in rows)
        return {
            key: torch.tensor([r[key] + [pad] * (width - len(r[key])) for r in rows])
            for key, pad in (
                ("input_ids", self.pad_token_id),
                ("attention_mask", 0),
                ("labels", -100),
            )
        }
