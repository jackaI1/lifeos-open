"""Small, response-masked PEFT LoRA experiment on synthetic formatting tasks."""

import hashlib
import json
import time
from pathlib import Path

from .backends import DEFAULT_MODEL, DEFAULT_REVISION
from .schema import parse_prediction

TRAIN_PATH = Path(__file__).parent / "datafiles" / "format_training.jsonl"


def load_training_examples(path: Path = TRAIN_PATH) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not rows:
        raise ValueError("training data is empty")
    for row in rows:
        if set(row) != {"prompt", "response"} or not row["prompt"]:
            raise ValueError("each training row needs prompt and response")
        parse_prediction(row["response"])
    return rows


def encode_example(tokenizer, prompt: str, response: str, max_length: int = 512) -> dict:
    prefix = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}], tokenize=True, add_generation_prompt=True
    )
    full = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}, {"role": "assistant", "content": response}],
        tokenize=True,
        add_generation_prompt=False,
    )
    if full[: len(prefix)] != prefix:
        raise ValueError("chat template is not prefix-compatible; cannot safely mask prompt")
    if len(full) > max_length or len(full) <= len(prefix):
        raise ValueError("training example length exceeds limit or has no response tokens")
    return {
        "input_ids": full,
        "attention_mask": [1] * len(full),
        "labels": [-100] * len(prefix) + full[len(prefix) :],
    }


def train_adapter(
    output: Path,
    *,
    model_id: str = DEFAULT_MODEL,
    revision: str = DEFAULT_REVISION,
    steps: int = 12,
    device: str = "cpu",
    seed: int = 42,
) -> dict:
    import peft
    import torch
    import transformers
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForCausalLM, AutoTokenizer, set_seed

    if steps < 1 or len(revision) != 40:
        raise ValueError("positive steps and an immutable 40-character revision required")
    if output.exists() and any(output.iterdir()):
        raise ValueError("adapter directory must be new or empty")
    set_seed(seed)
    torch.set_num_threads(4)
    tokenizer = AutoTokenizer.from_pretrained(model_id, revision=revision)
    examples = [encode_example(tokenizer, **row) for row in load_training_examples()]
    base = AutoModelForCausalLM.from_pretrained(
        model_id, revision=revision, torch_dtype=torch.float32, trust_remote_code=False
    )
    model = get_peft_model(
        base,
        LoraConfig(
            task_type="CAUSAL_LM",
            r=4,
            lora_alpha=8,
            lora_dropout=0.0,
            target_modules=["q_proj", "v_proj"],
            bias="none",
            revision=revision,
        ),
    )
    model.to(device)
    model.train()
    model.config.use_cache = False
    trainable = [(name, p) for name, p in model.named_parameters() if p.requires_grad]
    before = {name: p.detach().cpu().clone() for name, p in trainable}
    optimizer = torch.optim.AdamW([p for _, p in trainable], lr=2e-4)
    losses = []
    started = time.perf_counter()
    for step in range(steps):
        batch = {
            k: torch.tensor([v], device=device) for k, v in examples[step % len(examples)].items()
        }
        optimizer.zero_grad(set_to_none=True)
        loss = model(**batch).loss
        if not torch.isfinite(loss):
            raise ValueError("non-finite training loss")
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for _, p in trainable], 1.0)
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
    delta = sum(float((p.detach().cpu() - before[name]).abs().sum()) for name, p in trainable)
    if delta <= 0:
        raise ValueError("training did not change adapter parameters")
    output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output, safe_serialization=True)
    metadata = {
        "base_model": model_id,
        "revision": revision,
        "seed": seed,
        "steps": steps,
        "device": device,
        "trainable_parameters": sum(p.numel() for _, p in trainable),
        "total_parameters": sum(p.numel() for p in model.parameters()),
        "training_examples": len(examples),
        "losses": losses,
        "parameter_change_l1": delta,
        "training_seconds": time.perf_counter() - started,
        "training_sha256": hashlib.sha256(TRAIN_PATH.read_bytes()).hexdigest(),
        "adapter_sha256": hashlib.sha256(
            (output / "adapter_model.safetensors").read_bytes()
        ).hexdigest(),
        "peft": peft.__version__,
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "learning_rate": 2e-4,
        "rank": 4,
        "alpha": 8,
        "target_modules": ["q_proj", "v_proj"],
        "prompt_loss_masked": True,
        "survey_data_used": False,
    }
    (output / "training.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata
