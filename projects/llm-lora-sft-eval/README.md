# llm-lora-sft-eval

I built a membership record reader to learn how the underlying idea works. This is a learning project.

## What I compare

I use [SmolLM2-135M-Instruct](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct), an Apache-2.0 open-weight instruction model, pinned to an exact version. Supervised fine-tuning (SFT) means showing it a record alongside the correct answer. LoRA trains a small set of added weights while leaving the original model fixed. QLoRA also compresses the original weights to four bits before training that add-on, reducing the memory needed for those weights.

I compare the original model, its four-bit version, and both saved adapters with the same prompt and deterministic generation. Keeping the four-bit original in the comparison helps separate compression effects from training effects. A small synthetic test does not establish performance on real documents, and I do not assume training improves the result.

In my [recorded Linux comparison](reports/README.md), both adapters answered all 32 held-out records correctly, while the original answered 4 correctly. These are fictional records in known formats, so I treat this as a narrow extraction result rather than evidence about real documents.

## Running a comparison

The full CPU comparison uses Linux for QLoRA. The pinned bitsandbytes version does not support this project's QLoRA path on macOS; ordinary LoRA and the short example above work there. [Run instructions](docs/runs.md) include GPU settings and the repeatable GitHub Actions benchmark.

```sh
uv sync --python 3.11 --extra dev --extra qlora
uv run llm-eval prepare --train 128 --validation 16 --test 32
uv run llm-eval train --config configs/cpu-lora.json --output runs/lora
uv run llm-eval train --config configs/cpu-qlora.json --output runs/qlora
uv run llm-eval evaluate --adapters runs/lora runs/qlora --output runs/comparison
```

Use fresh run directories each time. I store parameters, loss measurements, adapters and evaluation reports using MLflow, an experiment log, under `runs/mlruns`; training does not start a server. A training `run.json` records the model version, data hashes, adapter weight hashes, trainable parameter count and whether four-bit layers were actually loaded.

## Serving and comparing speed

I merge the adapter into a copy of the original weights, then start one model server at a time. The same held-out records go to both. I measure complete request times and output tokens per second, alongside the same strict answer scores. MLflow, a local run notebook for settings, numbers and files, links these measurements back to the training run.

The quick example uses a real CPU server built with Transformers, the model-loading library. For vLLM, an engine that batches generation requests, start Docker and run:

```sh
uv run llm-eval serve-compare --export runs/export --backend vllm --device cpu --output runs/vllm
uv run llm-eval report --output runs/comparison-vllm
```

Both routes generate real answers from the saved weights. Their reports stay separate because they use different engines. The runner stops its servers automatically and records cleanup. In a separate [recorded CPU serving run](reports/serving/README.md), the adapter answered 26 of 32 held-out records exactly, versus three for the original; vLLM median request time was 1.62 seconds versus 4.16 seconds. The [serving guide](docs/serving.md) covers the Linux/Apple-silicon CPU images, a small NVIDIA GPU recipe, concurrent requests, repeat measurements and optional MLflow web view. A two-step adapter and a short speed check do not prove better accuracy or production capacity.

## Data and scoring

The generated dataset is public-domain fictional data under CC0. Each member has two differently formatted records, and both stay in the same split. I check for duplicate text, duplicate row IDs, shared members and shared answers across splits before training or evaluation. File hashes detect later changes. The [data card](docs/data-card.md) explains what is generated, missing fields and limitations.

Exact match requires the entire JSON answer to be correct. Field F1 measures correct field/value pairs; with exactly four required fields this equals the fraction of fields correct. Broken JSON, extra keys and wrong value types receive no credit. Explicit JSON `null` is a valid answer for a missing region.

I report 95% bootstrap confidence intervals, which estimate how scores could vary with another sample, plus paired differences against the original model. I also group records by member when calculating uncertainty because two versions of one member are related. The [evaluation design](docs/design.md) explains these choices.

## Tests and limits

There are 6 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `llm-lora-sft-eval-benchmark.yml`, `llm-lora-sft-eval-serving.yml`, `llm-lora-sft-eval-ci.yml`.

Generated output omitted from this copy: reports/ (generated output). Regenerate it with the project scripts.
