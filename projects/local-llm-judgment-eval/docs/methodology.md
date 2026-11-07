# What this experiment measures

I want to know whether a local language model can give useful probabilities about a public opinion survey. A model's fluent explanation does not tell me that. This tool asks for four numbers, checks the numbers, and compares them with published survey percentages.

## Public data and population

The source is [Pew Research Center's American Trends Panel Wave 132 topline](https://www.pewresearch.org/wp-content/uploads/2023/08/SR_23.08.28_views-of-ai_topline.pdf), fielded July 31 to August 6, 2023. The [accompanying report and methodology](https://www.pewresearch.org/short-reads/2023/08/28/growing-public-concern-about-the-role-of-artificial-intelligence-in-daily-life/) describe the weighted survey of 11,201 US adults. Four help/hurt items went to each survey form, with 5,621 and 5,580 respondents respectively.

I transcribed nine published distributions: overall feelings about AI and eight help/hurt items. Each row preserves the source variable, PDF page, sample size, four published percentages and a matching population persona. The question text and answer labels are paraphrased, so this is not an exact questionnaire replication. No individual survey records are stored. Each persona describes an unspecified US adult aged 18 or older in the survey period. I avoid adding narrower demographic attributes that the reference distributions do not support.

`src/local_llm_judgment_eval/datafiles/survey.json` is bundled with the package. Its SHA-256 is pinned in `data.py` and `survey.sha256`. Loading checks the bytes before validating the data structure. Review the source and update both pins deliberately if the dataset changes. This protects the committed transcription from accidental changes; it does not prove the transcription is correct. The PDF page and original variable let a reader check it.

The no-answer category stays in the evaluation. Published whole percentages sometimes sum to 101 because of rounding. I divide every row by its own total, preserving the published ratios, rather than inventing respondent counts. These are weighted aggregate percentages, not raw observations.

## Typed output and retries

Every model must return a JSON object with exactly `A`, `B`, `C`, `D`. The Pydantic model, a Python schema validator, requires finite numeric values in [0, 1] with a total within 0.000001 of one. Strings, booleans, missing or extra keys, duplicate keys, Markdown, non-finite numbers and extra prose fail. The tool does not clip values or repair the response after generation.

Ollama receives the JSON schema as a generation constraint. Transformers receives the same requested contract in the prompt but uses ordinary sampled generation. Both pass the identical final validator. This is a comparison of these two configured systems, not a controlled test of inference engines alone: Ollama uses quantized weights and schema guidance, while Transformers uses float32 weights without constrained decoding.

Each repeat gets seed `42 + repeat_index` by default. A retry keeps that seed and adds a correction request to the original prompt. It never adds survey targets. Every attempt retains its raw response, error type and elapsed time. Exhausted retries produce an explicit rejection. Results include acceptance coverage, attempt counts, per-case predictions and all failures. An all-rejected command exits with status 2 after writing its report. Connection or setup failure exits with status 1.

## Scores

For model probabilities p and normalized survey distribution q, with four categories:

- **Expected multiclass Brier:** `1 + sum(p[k]^2 - 2*p[k]*q[k])`. This is the expected squared error against a randomly drawn respondent's one-hot answer. It is not just the squared distance to the survey distribution. Even a perfect distribution forecast has nonzero Brier when respondents disagree. Range: 0 to 2.
- **Excess Brier:** `sum((p[k]-q[k])^2)`. This removes the irreducible survey disagreement. A perfect distribution match scores zero.
- **Total variation (TV):** `0.5 * sum(abs(p[k]-q[k]))`, from 0 to 1. It describes how much probability mass needs moving to match the reference.
- **Jensen-Shannon divergence:** mean base-2 KL divergence from each distribution to their midpoint, from 0 to 1 bit. Zero entries contribute zero.
- **Soft classwise expected calibration error (ECE):** independently for each answer slot, group predicted probabilities into ten equal-width bins. Within a bin compare mean prediction with mean survey frequency. Weight by the bin's fraction of predictions and average over the four slots. A prediction of 1 belongs in the final bin. Unlike pooling categories, this avoids cancellation between different answer slots. It measures agreement with aggregate frequencies, not individual-level calibration.
- **Repeat TV:** average pairwise TV between accepted repeats within each question, then average across questions with at least two accepted runs. Zero means identical outputs, including consistently wrong outputs. The JSON records the fraction of questions with enough accepted repeats.

Scores average equally over accepted case/repeat pairs, not over invented individual respondent records. With uneven rejections, this can weight questions unevenly. Always inspect coverage and the per-case rows before comparing models. There is no automatic ranking. The compare command refuses different datasets, case selections, seeds, repeat counts or retry budgets.

Nine related questions from one wave are too few to establish broad calibration. ECE depends on binning and may hide within-bin errors. Repeated predictions are not independent survey observations, and the tool does not calculate population confidence intervals. A model may have encountered this public report during pretraining, so these are reproducible benchmark targets, not a guaranteed unseen test set. Models are not substitutes for respondents or evidence about a particular person's beliefs.

## Timing and memory

A run's wall time includes every retry, validation and rejected attempt. Ollama uses `keep_alive: 0`, unloading after each request, so its measurements include cold starts. Transformers' initial load time appears separately in model metadata; generation synchronizes the device before returning. Do not compare these latency numbers as engine speed alone.

A thread samples resident memory (RSS) every 20 ms during each run and joins on exit, including failure paths. Client RSS is always measured. Pass `--ollama-pid` only for a server you have identified: its process tree RSS is measured separately, and the sampler records its process identity. This is a sampled peak estimate that can double-count shared pages; it can miss brief peaks and excludes remote servers and GPU-only memory. Without a server PID, server memory is `null`, never zero. Transformers records device allocations separately where available. MPS reports current tensor allocation after generation; CUDA reports the allocator's high-water mark. Neither is directly equivalent to RSS or total system memory.

## The small LoRA experiment

LoRA trains small additional matrices while leaving the base model frozen. PEFT is the library that attaches, saves and reloads those matrices. My default experiment uses Qwen2.5-0.5B-Instruct at immutable revision `7ae557604adf67be50417f59c2c2f167def9a775` with rank 4 adapters on attention query/value projections, learning rate 0.0002 and 12 single-example optimizer steps.

The 24 committed training examples ask for probabilities of colored token categories in a bag. They contain no survey questions, demographic groups or response distributions. Training masks all prompt tokens out of the loss, leaving only the response tokens as learning targets. Examples exceeding 512 tokens are rejected instead of silently truncating away the answer. The training log records every loss, trainable parameter count, parameter change, data hash, base revision and adapter weight hash. Reload verifies the base identity and adapter checksum before inference.

This is a small working adaptation experiment, not evidence of improved survey accuracy. A loss change on synthetic formatting tasks does not establish better calibration. I compare the reloaded adapter and the base model against the same held-out survey rows and preserve whichever results occur.

## Reproduction

The project uses Python 3.11 through 3.13 and `uv.lock` to pin dependencies. `uv sync --frozen --extra dev` installs the light test environment; add `--extra local` for real inference and training. Heavy imports happen only when those commands are selected. A regular CI run requires no model download or credentials. The README contains exact commands, and `reports/` holds the measured local run evidence.
