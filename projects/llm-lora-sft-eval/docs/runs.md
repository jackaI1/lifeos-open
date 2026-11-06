# Running and inspecting experiments

## CPU check on macOS or Linux

Run the five quick-start commands in the README. Python 3.11 or 3.12 is supported; `uv sync --python 3.11 --extra dev` installs it automatically if needed. The smoke recipe performs two optimizer steps, not a useful training budget. Network access is required once for dependencies and the public model, and then the Hugging Face cache can be reused. Allow about 2 GB of free RAM for this small LoRA recipe; measured usage depends on platform and batch size.

Full local LoRA uses `configs/cpu-lora.json`. Linux x86-64 can additionally install `--extra qlora` and use `configs/cpu-qlora.json` for real NF4 CPU training. macOS should use Linux GitHub Actions for the QLoRA recipe. Unsupported platforms fail with an actionable error, without a fallback that changes the experiment.

## Reproduce the public benchmark

From a checkout with GitHub CLI access:

```sh
gh workflow run benchmark.yml --repo jackaI1/llm-lora-sft-eval -f steps=80
gh run list --repo jackaI1/llm-lora-sft-eval --workflow benchmark.yml --limit 5
gh run watch <run-id> --repo jackaI1/llm-lora-sft-eval --exit-status
gh run download <run-id> --repo jackaI1/llm-lora-sft-eval -n held-out-evidence -D runs/download
```

The workflow prepares 128/16/32 rows with seed 42, trains both adapters for the requested step count, and evaluates base, NF4 base, LoRA and QLoRA on all 32 held-out rows. It publishes all four prediction sets and both adapter checkpoints, their metadata, data and local MLflow store. Artifacts expire after 14 days; compact recorded reports remain in `reports/`. Benchmark pushes run when training, model-loading, data or configuration changes; report formatting and documentation edits do not repeat expensive training. Regular CI still exercises evaluation with real models on every PR. The regular CI always runs unit tests and two real optimizer steps for each adapter on Linux.

## Limited-memory NVIDIA GPU

Install a CUDA-compatible PyTorch wheel for your driver, then `uv sync --extra qlora --extra dev`. Confirm `uv run python -c 'import torch; print(torch.cuda.is_available())'` prints `True`. The standard PyPI Linux torch wheel includes CUDA runtime dependencies; a CPU-only wheel cannot execute this path. If using another wheel, manage that environment explicitly instead of letting a later sync replace it.

```sh
uv run llm-eval prepare
uv run llm-eval train --config configs/cuda-lora.json --output runs/gpu-lora
uv run llm-eval train --config configs/cuda-qlora.json --output runs/gpu-qlora
uv run llm-eval evaluate --adapters runs/gpu-lora runs/gpu-qlora --output runs/gpu-comparison
```

The defaults use batch two, eight accumulation steps, rank eight, 256 tokens and gradient checkpointing. Mixed precision is bf16 if the GPU supports it, otherwise fp16. For memory errors, reduce batch size to one and double accumulation to preserve the effective batch. Increase the sequence limit only if a data row requires it. This project's 135M model is deliberately small; these settings are not a measured memory guarantee for a larger model.

## Run records and cleanup

Training and evaluation are foreground commands that exit after finishing. Generation reports its model variant and record count to stderr at bounded intervals, leaving the final JSON result on stdout. Full CPU runs can take tens of minutes, especially four-bit generation; use the two-step smoke recipe for an installation check. They start no browser or server. Each output directory must be new, preventing accidental checkpoint overwrite. MLflow stores files under `runs/mlruns` and never needs credentials. To browse records visually, optionally install the full `mlflow` package in a separate environment and run `mlflow ui --backend-store-uri file://<absolute-path-to-runs/mlruns>` in a terminal; stop it with Ctrl-C when done. Copying an MLflow file store between computers can leave old absolute artifact URIs in its metadata, so the separately included adapters and reports are the portable evidence.

Delete only your own `runs/` and generated `data/` directories when finished. They are ignored by Git. Do not upload private intake data; this benchmark requires the generated fictional records.
