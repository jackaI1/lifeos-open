# local-llm-judgment-eval

I built a local model survey checker to learn how the underlying idea works. This is a learning project.

The survey targets come from the public Pew Research Center survey identified in `docs/methodology.md`; the coding tasks and training examples are constructed examples.

## Try it

From this project directory:

Try the scoring and report without downloading a model:

```bash
uv sync --frozen --extra dev
uv run judgment-eval baseline --output artifacts/baseline
```

Open `artifacts/baseline/comparison.md`. The category table shows which questions need review and where predictions differ most from the survey. In `results.json`, `released_prediction` is empty when the largest reported probability is below 0.4 or the response is invalid. I inspect those cases before using them; change the cutoff with `--confidence-threshold`. This cutoff is a screening rule, not a measurement of model accuracy. Each call also leaves a timestamped record in `audit.jsonl`, with a hash of its prompt rather than the prompt itself.

## What I can compare

The tool asks nine questions about AI from a [published Pew Research Center survey](https://www.pewresearch.org/short-reads/2023/08/28/growing-public-concern-about-the-role-of-artificial-intelligence-in-daily-life/). Each model gets a persona describing an unspecified US adult aged 18 or older, matching the survey population. It predicts four answer probabilities, including no answer.

I run models through Ollama, a local model server, or Hugging Face Transformers, a Python library that loads model weights directly. Both use the same evaluation interface. The tool checks the response against a typed schema, a strict definition of its allowed fields and numbers. It retries invalid responses within a fixed budget and records exhausted retries as rejections.

The report shows agreement with the survey, calibration, changes across repeated runs, response time and memory. A model that rejects many questions can look good on its remaining answers, so I show coverage next to every score. These predictions describe groups; they do not establish what an individual believes.

## Run a local model

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Ollama](https://ollama.com/download) first. Python 3.11 through 3.13 is supported. The Python commands work on CPU; Apple Silicon can use `--device mps`, and a compatible NVIDIA setup can use `--device cuda`.

For Ollama, start `ollama serve` in a separate terminal if it is not already running. Then:

```bash
ollama pull qwen2.5:0.5b
uv run judgment-eval run --backend ollama --model qwen2.5:0.5b \
  --repeats 2 --max-attempts 2 --output artifacts/ollama
```

The server's memory is separate from the Python client's memory. To measure it, identify your server's PID with `lsof -nP -iTCP:11434 -sTCP:LISTEN` and add `--ollama-pid <PID>`. Without that, the report explicitly leaves server memory unmeasured. The tool unloads the model after each request. Stop a server you started for this experiment with Ctrl-C in its terminal when finished; preserve an existing server used by other work.

For Transformers, install the local model dependencies and run the pinned base model:

```bash
uv sync --frozen --extra dev --extra local
uv run judgment-eval run --backend transformers --device cpu \
  --repeats 2 --max-attempts 2 --output artifacts/hf-base
```

The default model is Qwen2.5-0.5B-Instruct. Its first download is about 1 GB. I pin its exact revision and save the Ollama model digest in the report. Other Hugging Face causal text models can be selected with `--model OWNER/MODEL --revision COMMIT_SHA`; they need a compatible chat template. Use `--cases cncexc health privacy` to shorten an experiment, keeping the same selection for each model.

## Tests and limits

I kept 9 files of test code and supporting test helpers in this copy. This is a file inventory, not an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `local-llm-judgment-eval-ci.yml`.
