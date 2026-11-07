"""Reload saved adapters and generate on the same untouched held-out rows."""

import gc
import json
import sys
from pathlib import Path

import mlflow
import torch
from peft import PeftModel
from transformers import set_seed

from llm_eval.data import canonical, load_splits, sha256
from llm_eval.metrics import paired_delta, score_row, summarize
from llm_eval.model import Config, load_model, prompt_ids
from llm_eval.report import render_failures
from llm_eval.tracking import tracked, tracking


def generate(config, rows, adapter=None, max_new_tokens=96, progress_label="model"):
    set_seed(config.seed)
    torch.set_num_threads(config.threads)
    model, tokenizer = load_model(config)
    if adapter:
        model = PeftModel.from_pretrained(model, str(Path(adapter) / "adapter"))
    model.eval()
    model.config.use_cache = True
    predictions = []
    try:
        with torch.inference_mode():
            for index, row in enumerate(rows, 1):
                ids = torch.tensor([prompt_ids(tokenizer, row["input"])], device=config.device)
                output = model.generate(
                    input_ids=ids,
                    attention_mask=torch.ones_like(ids),
                    do_sample=False,
                    max_new_tokens=max_new_tokens,
                    pad_token_id=tokenizer.pad_token_id,
                    eos_token_id=tokenizer.eos_token_id,
                )
                predictions.append(
                    tokenizer.decode(output[0, ids.shape[1] :], skip_special_tokens=True)
                )
                if index == 1 or index % 8 == 0 or index == len(rows):
                    print(
                        f"{progress_label}: {index}/{len(rows)} records generated",
                        file=sys.stderr,
                        flush=True,
                    )
    finally:
        del model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    return predictions


@tracked("evaluation")
def evaluate(
    data_dir,
    adapters,
    output_dir,
    limit=None,
    samples=2000,
    tracking_dir="runs/mlruns",
    max_new_tokens=96,
):
    if not adapters or (limit is not None and limit < 1) or max_new_tokens < 1:
        raise ValueError("Supply adapters, a positive limit, and a positive generation budget")
    dataset, manifest = load_splits(data_dir)
    output = Path(output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Report directory is not empty; use a new output directory")
    metadata = [json.loads((Path(p) / "run.json").read_text()) for p in adapters]
    reference = metadata[0]["config"]
    mlflow.set_tag("training_run_ids", ",".join(m["mlflow_run_id"] for m in metadata))
    manifest_hash = sha256(Path(data_dir) / "manifest.json")
    for meta in metadata:
        if meta["manifest_sha256"] != manifest_hash:
            raise ValueError("Adapter was trained on a different dataset manifest")
        if any(meta["config"][k] != reference[k] for k in ("model", "revision", "seed")):
            raise ValueError("Adapters must share a pinned base model and seed")
    modes = [m["config"]["mode"] for m in metadata]
    if len(set(modes)) != len(modes):
        raise ValueError("Use one adapter per mode")
    rows = list(dataset["test"])
    if limit is not None:
        rows = rows[:limit]
    output.mkdir(parents=True, exist_ok=True)
    baseline = Config(**{**reference, "mode": "lora"})
    variants = [("base", baseline, None)]
    # A quantized baseline isolates quantization effects from adapter learning.
    if "qlora" in modes:
        qconfig = Config(**next(m["config"] for m in metadata if m["config"]["mode"] == "qlora"))
        variants.append(("base_nf4", qconfig, None))
    variants += [
        (m["config"]["mode"], Config(**m["config"]), p)
        for m, p in zip(metadata, adapters, strict=True)
    ]
    scores, predictions = {}, {}
    for name, config, adapter in variants:
        predictions[name] = generate(config, rows, adapter, max_new_tokens, progress_label=name)
        scores[name] = [
            score_row(pred, row["target"])
            for pred, row in zip(predictions[name], rows, strict=True)
        ]
    report = {
        "n": len(rows),
        "total_held_out": len(dataset["test"]),
        "row_ids": [r["id"] for r in rows],
        "manifest": manifest,
        "model": reference["model"],
        "revision": reference["revision"],
        "bootstrap": {
            "samples": samples,
            "seed": reference["seed"],
            "unit": "row",
            "warning": "Two variants per entity are correlated; see entity bootstrap below.",
        },
        "generation": {"do_sample": False, "max_new_tokens": max_new_tokens},
        "runs": {
            name: summarize(value, samples, reference["seed"]) for name, value in scores.items()
        },
        "delta_vs_base": {
            name: paired_delta(scores["base"], scores[name], samples, reference["seed"])
            for name in modes
        },
        "adapter_runs": metadata,
    }
    if "qlora" in modes:
        report["qlora_delta_vs_nf4"] = paired_delta(
            scores["base_nf4"], scores["qlora"], samples, reference["seed"]
        )
    # Cluster bootstrap: average both variants first, then resample independent entities.
    entities = sorted({r["entity_id"] for r in rows})
    clustered = {}
    for name, values in scores.items():
        clustered[name] = [
            {
                key: sum(values[i][key] for i, r in enumerate(rows) if r["entity_id"] == entity)
                / sum(r["entity_id"] == entity for r in rows)
                for key in values[0]
            }
            for entity in entities
        ]
    report["entity_bootstrap"] = {
        "n_entities": len(entities),
        "unit": "entity",
        "samples": samples,
        "runs": {k: summarize(v, samples, reference["seed"]) for k, v in clustered.items()},
        "delta_vs_base": {
            k: paired_delta(clustered["base"], clustered[k], samples, reference["seed"])
            for k in modes
        },
    }
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    records = []
    for name in predictions:
        for row, pred, score in zip(rows, predictions[name], scores[name], strict=True):
            records.append(
                {
                    "variant": name,
                    "id": row["id"],
                    "entity_id": row["entity_id"],
                    "input": row["input"],
                    "target": row["target"],
                    "prediction": pred,
                    "scores": score,
                }
            )
    (output / "predictions.jsonl").write_text("".join(canonical(r) + "\n" for r in records))
    (output / "failures.md").write_text(render_failures(records))
    tracking(tracking_dir)
    run = mlflow.active_run()
    mlflow.log_params(
        {
            "model": reference["model"],
            "revision": reference["revision"],
            "n_test": len(rows),
            "bootstrap_samples": samples,
            "manifest_sha256": manifest_hash,
        }
    )
    mlflow.log_metrics(
        {
            f"{name}_{key}": value["mean"]
            for name, metrics in report["runs"].items()
            for key, value in metrics.items()
        }
    )
    report["mlflow_run_id"] = run.info.run_id
    (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    mlflow.log_artifacts(str(output), "evaluation")
    return report
