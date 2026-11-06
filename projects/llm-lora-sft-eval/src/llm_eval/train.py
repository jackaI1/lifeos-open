"""Completion-only SFT: frozen base weights, trainable adapters, local MLflow."""

import hashlib
import json
from pathlib import Path

import mlflow
import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import Trainer, TrainerCallback, TrainingArguments, set_seed

from llm_eval.data import canonical, load_splits, sha256
from llm_eval.model import CompletionCollator, encode_row, load_model
from llm_eval.tracking import tracked, tracking


def adapter_digest(model):
    digest = hashlib.sha256()
    for name, parameter in model.named_parameters():
        if parameter.requires_grad:
            digest.update(name.encode())
            digest.update(parameter.detach().float().cpu().numpy().tobytes())
    return digest.hexdigest()


class LogMetrics(TrainerCallback):
    def on_log(self, args, state, control, logs=None, **kwargs):
        mlflow.log_metrics(
            {k: v for k, v in (logs or {}).items() if isinstance(v, (int, float))},
            step=state.global_step,
        )


@tracked("training")
def train(config, data_dir, output_dir, tracking_dir="runs/mlruns"):
    mlflow.log_params(config.dict())
    config.validate()
    output = Path(output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Output directory is not empty; use a new run directory")
    output.mkdir(parents=True, exist_ok=True)
    torch.set_num_threads(config.threads)
    set_seed(config.seed)
    dataset, manifest = load_splits(data_dir)
    model, tokenizer = load_model(config)
    quantized = sum(type(m).__name__ == "Linear4bit" for m in model.modules())
    if config.mode == "qlora":
        if quantized == 0:
            raise RuntimeError("QLoRA did not create four-bit layers")
        model = prepare_model_for_kbit_training(
            model,
            use_gradient_checkpointing=config.gradient_checkpointing,
            gradient_checkpointing_kwargs={"use_reentrant": False},
        )
    model = get_peft_model(
        model,
        LoraConfig(
            task_type="CAUSAL_LM",
            r=config.rank,
            lora_alpha=config.alpha,
            lora_dropout=0.05,
            target_modules=["q_proj", "v_proj"],
            bias="none",
        ),
    )
    model.config.use_cache = False
    before = adapter_digest(model)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    tokenized = {
        s: dataset[s].map(
            lambda row: encode_row(tokenizer, row, config.max_length),
            remove_columns=dataset[s].column_names,
        )
        for s in ("train", "validation")
    }
    args = TrainingArguments(
        output_dir=str(output / "checkpoints"),
        max_steps=config.steps,
        per_device_train_batch_size=config.batch_size,
        per_device_eval_batch_size=config.batch_size,
        gradient_accumulation_steps=config.accumulation,
        learning_rate=config.learning_rate,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        optim="adamw_torch",
        weight_decay=0.01,
        use_cpu=config.device == "cpu",
        bf16=config.dtype() == torch.bfloat16,
        fp16=config.dtype() == torch.float16,
        gradient_checkpointing=config.gradient_checkpointing,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        save_strategy="no",
        eval_strategy="no",
        logging_steps=1,
        report_to=[],
        seed=config.seed,
        data_seed=config.seed,
        label_names=["labels"],
        dataloader_pin_memory=config.device == "cuda",
        disable_tqdm=True,
    )
    tracking(tracking_dir)
    run = mlflow.active_run()
    mlflow.log_params(
        {
            **config.dict(),
            "effective_batch_size": config.batch_size * config.accumulation,
            "trainable_parameters": trainable,
            "four_bit_layers": quantized,
            "dataset_sha256": sha256(Path(data_dir) / "manifest.json"),
        }
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["validation"],
        data_collator=CompletionCollator(tokenizer.pad_token_id),
        callbacks=[LogMetrics()],
    )
    result = trainer.train()
    validation = trainer.evaluate()
    mlflow.log_metrics(result.metrics)
    mlflow.log_metrics(validation)
    after = adapter_digest(model)
    if before == after:
        raise RuntimeError("Adapter weights did not change during training")
    model.save_pretrained(output / "adapter", safe_serialization=True)
    tokenizer.save_pretrained(output / "adapter")
    metadata = {
        "config": config.dict(),
        "manifest": manifest,
        "manifest_sha256": sha256(Path(data_dir) / "manifest.json"),
        "effective_batch_size": config.batch_size * config.accumulation,
        "trainable_parameters": trainable,
        "four_bit_layers": quantized,
        "adapter_before_sha256": before,
        "adapter_after_sha256": after,
        "training": result.metrics,
        "validation": validation,
        "mlflow_run_id": run.info.run_id,
    }
    (output / "run.json").write_text(json.dumps(metadata, indent=2) + "\n")
    mlflow.log_dict(metadata, "run.json")
    mlflow.log_text(canonical(manifest), "data-manifest.json")
    mlflow.log_artifacts(str(output / "adapter"), "adapter")
    return metadata
