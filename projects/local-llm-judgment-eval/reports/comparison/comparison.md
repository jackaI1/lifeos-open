# Local model comparison

Lower scores and repeat TV are better. Coverage must be read alongside every score.
Scores are conditional on accepted outputs; rejected runs have no inferred score.

| Model | Coverage | Brier | Excess Brier | Soft ECE | TV | JS bits | Repeat TV | Latency s | Client RSS MiB | Server tree RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference: uniform, not an LLM | 18/18 | 0.7500 | 0.1195 | 0.1195 | 0.3037 | 0.1337 | 0.0000 | 0.0002 | 34.4531 | n/a |
| ollama: qwen2.5:0.5b | 11/18 | 1.3928 | 0.7625 | 0.3485 | 0.6971 | 0.4957 | 0.5000 | 1.2020 | 39.5469 | 592.8281 |
| transformers: Qwen/Qwen2.5-0.5B-Instruct | 0/18 | n/a | n/a | n/a | n/a | n/a | n/a | 3.5436 | 1479.1562 | n/a |
| transformers: Qwen/Qwen2.5-0.5B-Instruct + LoRA | 9/18 | 1.3709 | 0.7404 | 0.3424 | 0.6849 | 0.4626 | n/a | 1.4809 | 1554.6094 | n/a |

Latency includes retries and rejected runs. Ollama unloads after every request, so its timings include cold loads. Transformers load time is recorded separately.
RSS is sampled every 20 ms and may miss short peaks. Server RSS requires an explicit server PID; n/a never means zero. GPU allocations and RSS are different measures.
Repeat TV uses accepted pairs within a question; JSON records its case coverage.
See results.json for raw generations, failures, seeds, targets and model identities.
