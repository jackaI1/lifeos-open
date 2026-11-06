# Serving the two models and keeping the evidence

I built a way to compare two versions of my membership-record reader because I wanted to know whether more dependable answers were worth the wait. One version uses the original language model. The other includes an adapter, a small set of extra numbers I train to teach the model this record-reading task.

I save a complete copy of each version, then ask both to read the same fictional records they have not seen during training. A local server, a program that waits for requests, generates each answer. I keep the answers beside the timing measurements so I can compare correctness and waiting time together.

## A complete CPU run

From the repository root, with Python 3.11 and uv installed:

```sh
uv sync --python 3.11 --extra dev
uv run llm-eval prepare --train 32 --validation 8 --test 8
uv run llm-eval train --config configs/cpu-smoke.json --output runs/smoke
uv run llm-eval evaluate --adapters runs/smoke --output runs/quality
uv run llm-eval export --adapter runs/smoke --output runs/export
uv run llm-eval serve-compare --export runs/export --backend transformers --output runs/http-cpu
uv run llm-eval report --output runs/comparison
```

Read `runs/comparison/comparison.md`. The CSV and JSON exports include every training, evaluation, export and serving run, including failures. Every command uses `runs/mlruns` by default; pass `--tracking another/directory` consistently to keep a separate experiment. Use fresh output directories for another attempt.

The short config takes two optimizer steps. It verifies the full path but does not establish an accuracy improvement. Use `configs/cpu-lora.json` for 80 steps and at least 32 held-out records when studying quality. The original evaluation command still provides paired bootstrap uncertainty, the four-bit baseline and detailed failures. The HTTP comparison adds speed measurements; it does not replace that analysis.

## vLLM on CPU

[vLLM](https://docs.vllm.ai/en/latest/getting_started/installation/cpu/) is an inference engine that can batch requests. Its server accepts requests in the [OpenAI completions format](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/). No OpenAI account or key is involved. Install and start Docker, then use the same exports:

```sh
uv run llm-eval serve-compare --export runs/export --backend vllm --device cpu --output runs/http-vllm
uv run llm-eval report --output runs/comparison-vllm
```

The runner selects the pinned `vllm/vllm-openai-cpu:v0.33.0-x86_64` image on Intel/AMD or `v0.33.0-arm64` on Apple silicon. Docker supplies Linux on macOS. Allow at least 4 GB of free memory for this small model, the server and its 1 GB key/value cache (stored attention state). The image download is about 1.3 to 1.8 GB. A running Docker engine is required; on a Mac, Docker Desktop or a deliberately started Colima VM can provide it. The runner owns its containers, not the owner's Docker engine.

The lighter `--backend transformers` path works directly on a Mac or Linux CPU without Docker. It loads the actual exported weights and generates real answers through the same HTTP request format. It serializes inference with a lock, so concurrent requests include queueing. Its results are labelled `transformers`, never presented as vLLM results. It supports only the non-streaming completions and models endpoints used here.

## A small NVIDIA GPU

With a Linux NVIDIA driver and NVIDIA Container Toolkit configured for Docker:

```sh
uv run llm-eval serve-compare --export runs/export --backend vllm --device cuda \
  --concurrency 4 --output runs/http-gpu
uv run llm-eval report --output runs/comparison-gpu
```

The GPU recipe pins `vllm/vllm-openai:v0.11.0`, uses half precision, a 512-token context, eager execution and a 50% GPU-memory allocation. The 135-million-parameter model is small enough to try on a modest GPU, but total free memory still matters. CI verifies the CPU recipes; I have not measured this GPU recipe. `--image` overrides the image for a compatible architecture or updated installation, and is saved in the run parameters.

## What is measured

- `output_tokens_per_s`: tokens reported by the server across successful requests divided by the wall time for the measured batch, including failed requests. It is not the mean of individual request speeds.
- `requests_per_s`: successful requests divided by that same wall time.
- `latency_p50_s` and `latency_p95_s`: median and 95th percentile of full successful HTTP request durations, including scheduling, queueing, generation and response transfer. These are not time-to-first-token measurements.
- `exact_match`, `field_f1` and schema/field scores: the existing strict scorer applied to each served answer. Failed requests receive zero quality credit. Truncated JSON receives no credit.

Defaults are one excluded warmup, concurrency one, greedy generation, a 96-token output limit and a 120-second timeout per request. Adjust with `--warmup`, `--concurrency`, `--max-tokens`, `--limit` and `--timeout`. No request is retried. Any measured request failure saves the partial evidence and marks the run FAILED; a warmup failure aborts before measurement. Startup and model loading are outside the throughput interval. A single short run is noisy, so repeat with new output directories before drawing conclusions.

The client sends the model's exact chat-template text to `/v1/completions`, so both engines receive the same prompt as local evaluation. Exported weights and dataset manifests are checked against their hashes. The report groups only matching model revisions, data, prompt/target cohorts, adapter weights, generation settings, engine/image and concurrency. It preserves every repeated run instead of picking a winner. CPU and GPU results, different engines, and different test subsets get separate tables.

## MLflow and lineage

[MLflow](https://mlflow.org/docs/latest/tracking/tracking-api) stores run settings, numbers and files. The shared lifecycle starts a run before work begins, records failures as FAILED with `error.json`, and closes the run when the operation finishes. Training logs losses at each step, final training and validation metrics, dataset hashes and adapter files. Local evaluation logs quality and prediction artifacts. Serving runs link to the training run ID and record their full command, parameters, per-record answers, metrics, server log and cleanup record. Export logs which adapter and model revision produced the served weights.

Everything is local with `mlflow-skinny`; no tracking service or paid account is needed. The report reads the MLflow store through `MlflowClient`, including all search pages. To inspect the web interface optionally install the matching full package in a separate environment:

```sh
uvx --from mlflow==3.5.1 mlflow ui --backend-store-uri "file://$(pwd)/runs/mlruns" --host 127.0.0.1 --port 5000
```

Stop that foreground command with Ctrl-C. It is an optional user preview, not started by training or CI.

## Ownership and cleanup

The runner starts one model server at a time on a temporary loopback port. Each output directory contains `resource.json` with its owner, exact command, PID, start time, port, container name if used, and cleanup command. A `finally` block stops that container or process group on success, HTTP errors and readiness failures, then verifies the port is closed and the container removed. Server logs stay on disk, not in an unbounded memory buffer. Docker container logs rotate at 10 MB. Ctrl-C unwinds the same cleanup; after a forced machine termination, use the recorded command for that exact resource.

## Checks

`uv run python scripts/smoke_serving.py --backend transformers --output runs/check` trains a real adapter, reloads it for local scoring, merges it, serves both exports, queries MLflow and verifies five finished runs with parameters and artifacts. Replace `transformers` with `vllm` to exercise the actual Docker CPU engine. For a longer comparison, add `--steps 80 --train 128 --test 32 --max-tokens 96`. The manual `serving and tracking` workflow defaults to these longer settings; pull requests use the short settings. The GitHub Actions `serving and tracking` matrix runs both backends and publishes the reports, request records, MLflow store and cleanup evidence. Unit tests cover the HTTP client contract, token validation, timing arithmetic, request failures, warmup exclusion, report grouping and failed-start cleanup.
