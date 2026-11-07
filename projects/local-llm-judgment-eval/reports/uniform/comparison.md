# Local model comparison

Lower scores and repeat TV are better. Coverage must be read alongside every score.
Scores are conditional on accepted outputs; rejected runs have no inferred score.

| Model | Coverage | Brier | Excess Brier | Soft ECE | TV | JS bits | Repeat TV | Latency s | Client RSS MiB | Server tree RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| reference: uniform, not an LLM | 18/18 | 0.7500 | 0.1195 | 0.1195 | 0.3037 | 0.1337 | 0.0000 | 0.0002 | 34.4531 | n/a |

Latency includes retries and rejected runs. Ollama unloads after every request, so its timings include cold loads. Transformers load time is recorded separately.
RSS is sampled every 20 ms and may miss short peaks. Server RSS requires an explicit server PID; n/a never means zero. GPU allocations and RSS are different measures.
Repeat TV uses accepted pairs within a question; JSON records its case coverage.
See results.json for raw generations, failures, seeds, targets and model identities.
