"""Export a pinned base and a full-precision merged adapter for identical serving."""

import gc
import json
from pathlib import Path

import mlflow
from peft import PeftModel

from llm_eval.data import sha256
from llm_eval.model import Config, load_model
from llm_eval.tracking import tracked


@tracked("export")
def export(adapter_dir, output_dir, tracking_dir="runs/mlruns"):
    source = Path(adapter_dir)
    metadata = json.loads((source / "run.json").read_text())
    config = Config(**{**metadata["config"], "mode": "lora", "device": "cpu", "precision": "fp32"})
    output = Path(output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Export directory is not empty")
    mlflow.log_params(config.dict())
    mlflow.set_tag("training_run_id", metadata["mlflow_run_id"])
    model, tokenizer = load_model(config)
    output.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(output / "base", safe_serialization=True)
    tokenizer.save_pretrained(output / "base")
    model = PeftModel.from_pretrained(model, str(source / "adapter"))
    merged = model.merge_and_unload(safe_merge=True)
    merged.save_pretrained(output / "merged", safe_serialization=True)
    tokenizer.save_pretrained(output / "merged")
    manifest = {
        "model": config.model,
        "revision": config.revision,
        "seed": config.seed,
        "manifest_sha256": metadata["manifest_sha256"],
        "training_run_id": metadata["mlflow_run_id"],
        "source_mode": metadata["config"]["mode"],
        "adapter_sha256": sha256(source / "adapter/adapter_model.safetensors"),
        "weights": {
            variant: {p.name: sha256(p) for p in sorted((output / variant).glob("*.safetensors"))}
            for variant in ("base", "merged")
        },
        "merge_note": "Adapter merged into original fp32 weights, including for NF4 training.",
    }
    (output / "export.json").write_text(json.dumps(manifest, indent=2) + "\n")
    mlflow.log_dict(manifest, "export.json")
    del merged, model
    gc.collect()
    return manifest
