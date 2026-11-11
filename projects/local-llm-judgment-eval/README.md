# local-llm-judgment-eval

I built a tool that asks small AI models that run on my own computer nine survey questions and checks their answers, because I wanted to know which models and settings are fast enough to use for LifeOS judgments without giving worse answers. This is a learning project.

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

I run models through three local backends, and every backend gets the same prompts:

- **Ollama**, a local model server that is easy to install.
- **Transformers**, a Python library that loads model weights directly. It can run in half precision (`float16` or `bfloat16`) to use less memory.
- **vLLM**, a server built for fast serving. The tool talks to its OpenAI-compatible API and streams the answer, so it can time the first token.

The tool checks each response against a typed schema, a strict definition of its allowed fields and numbers. It retries invalid responses within a fixed budget and records exhausted retries as rejections.

The report shows agreement with the survey, calibration, changes across repeated runs, response time, time to first token, tokens per second and memory. A model that rejects many questions can look good on its remaining answers, so I show coverage next to every score. The comparison names the fastest model that answered at least 90% of questions. These predictions describe groups; they do not establish what an individual believes.

## Run a local model

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Ollama](https://ollama.com/download) first. Python 3.11 through 3.13 is supported.

For Ollama, start `ollama serve` in a separate terminal if it is not already running. Then:

```bash
ollama pull qwen2.5:0.5b
uv run judgment-eval run --backend ollama --model qwen2.5:0.5b \
  --repeats 2 --max-attempts 2 --output artifacts/ollama
```

The server's memory is separate from the Python client's memory. To measure it, identify your server's PID with `lsof -nP -iTCP:11434 -sTCP:LISTEN` and add `--ollama-pid <PID>`. Without that, the report explicitly leaves server memory unmeasured. The tool unloads the model after each request, so Ollama's time to first token includes loading the model. Stop a server you started for this experiment with Ctrl-C in its terminal when finished; preserve an existing server used by other work.

For Transformers, install the local model dependencies and run the pinned base model:

```bash
uv sync --frozen --extra dev --extra local
uv run judgment-eval run --backend transformers --device cpu \
  --repeats 2 --max-attempts 2 --output artifacts/hf-base
```

The default model is Qwen2.5-0.5B-Instruct. Its first download is about 1 GB. I pin its exact revision and save the Ollama model digest in the report. Add `--dtype bfloat16` or `--dtype float16` to test half precision. Other Hugging Face causal text models can be selected with `--model OWNER/MODEL --revision COMMIT_SHA`; they need a compatible chat template. Use `--cases cncexc health privacy` to shorten an experiment, keeping the same selection for each model.

For vLLM, start the server with the same model and the same pinned revision, then point the tool at it:

```bash
vllm serve Qwen/Qwen2.5-0.5B-Instruct --revision 7ae557604adf67be50417f59c2c2f167def9a775 --port 8000
uv run judgment-eval run --backend vllm --model Qwen/Qwen2.5-0.5B-Instruct \
  --revision 7ae557604adf67be50417f59c2c2f167def9a775 --batch-concurrency 8 \
  --output artifacts/vllm
```

`--batch-concurrency 8` also sends the survey prompts eight at a time and records batch requests per second. The tool refuses to start if the server does not list the model you asked for.

To compare the three backends on the same questions, run each one into its own folder and then combine them:

```bash
uv run judgment-eval compare artifacts/ollama/results.json artifacts/hf-base/results.json \
  artifacts/vllm/results.json --output artifacts/comparison
```

Open `artifacts/comparison/comparison.md`. The last line names the fastest model that answered at least 90% of questions. Check its score columns before choosing it.

## Find the settings worth using

`profile` runs a fixed set of survey prompts through the Transformers backend under `torch.profiler`, a PyTorch tool that times every operation. For each batch size and precision it records the time spent in each operation, tokens per second, prompts per second and peak memory. It writes `profile.json` and `profile.md`.

```bash
uv run judgment-eval profile --dtypes float32 bfloat16 --batch-sizes 1 4 8 \
  --output artifacts/profile
```

The first configuration is the baseline. The report flags any configuration whose answers differ from the baseline, and any change of 10% or more in tokens per second or memory. Those flags tell me where a faster setting changes what the model says, which matters more than speed alone.

## Scoring kernel on the GPU

Each answer is scored against the survey's distribution with a soft cross-entropy: softmax the model's choice scores at a temperature, then measure how far they are from the survey percentages. The plain PyTorch version is in `src/local_llm_judgment_eval/kernels.py`. The fused version is a [Triton](https://triton-lang.org/) GPU kernel in `triton_kernels.py`. It does the softmax, the temperature scaling and the scoring in one pass over each row instead of several.

```bash
uv run judgment-eval bench-kernel --device cuda --batch-sizes 1024 16384 131072 \
  --output artifacts/kernel
```

On a machine without a GPU the same command times only the PyTorch version and writes `n/a` for the fused version, so it never reports a fake speed-up. The tests compare the two versions on random inputs and on extreme logits, up to 10,000 and down to 0.0001.

## Keep track of runs

`log` writes each model in a `results.json` file to MLflow, an experiment tracker. Each model becomes one run with its settings as parameters, and its scores, latency, tokens per second and typed-output coverage as metrics. The runs and their artifacts go into a local SQLite database, `mlflow.db`, in this folder.

```bash
uv sync --frozen --extra dev --extra tracking
uv run judgment-eval log artifacts/comparison/results.json --experiment my-runs
uv run judgment-eval registry register --experiment my-runs --min-coverage 0.9
uv run judgment-eval registry show
```

`register` puts the run with the lowest excess Brier score (a score where lower is better) among runs that answered enough questions into the model registry, as a new version. The first version becomes the `champion`, which is the model the judgment feature uses. Later versions wait until I promote them:

```bash
uv run judgment-eval registry promote 2     # make version 2 the champion
uv run judgment-eval registry rollback      # go back to the champion before that
```

`run --champion --output artifacts/feature` runs the evaluation with whichever model is the champion, so the feature follows the registry rather than a hard-coded model name.

## Tests and limits

The tests run in GitHub Actions, in the `local-llm-judgment-eval / CI` workflow. Each group has its own job:

- **Core scoring and CLI**: the original tests, plus the vLLM and Ollama backend tests against stub servers that answer like the real ones. No GPU and no model download.
- **Scoring kernel**: the Triton kernel runs in Triton's interpreter on the CPU, so the GPU kernel is tested on a machine without a GPU. The PyTorch path and the CPU fallback are tested everywhere.
- **Profiling**: a tiny randomly initialised model with a character tokenizer checks the report format and the flags. Nothing is downloaded.
- **MLflow**: logging, registering, promoting and rolling back run against a local SQLite database.

Those tests check correctness, not speed. I have not yet run the GPU benchmark or the vLLM server on my workstation for this README, so the speed numbers there are still to come. When I do, I will save them in `reports/` next to the commands that produced them.

Limits I know about: the Triton kernel is written for the short answer lists the survey uses, and I have only checked it in the interpreter, not yet on my GPU. MLflow's file-based store is in maintenance mode, so the registry uses SQLite. The profiler reports CPU time per operator and GPU memory, but not GPU kernel time.

The tests are in the `tests` folder. The CI runs are the record that they pass.
