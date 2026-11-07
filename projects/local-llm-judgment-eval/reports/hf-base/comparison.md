# Local model comparison

Lower scores and repeat TV are better. Coverage must be read alongside every score.
Scores are conditional on accepted outputs; rejected runs have no inferred score.

| Model | Coverage | Brier | Excess Brier | Soft ECE | TV | JS bits | Repeat TV | Latency s | Client RSS MiB | Server tree RSS MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transformers: Qwen/Qwen2.5-0.5B-Instruct | 0/18 | n/a | n/a | n/a | n/a | n/a | n/a | 3.5436 | 1479.1562 | n/a |

Latency includes retries and rejected runs. Ollama unloads after every request, so its timings include cold loads. Transformers load time is recorded separately.
RSS is sampled every 20 ms and may miss short peaks. Server RSS requires an explicit server PID; n/a never means zero. GPU allocations and RSS are different measures.
Repeat TV uses accepted pairs within a question; JSON records its case coverage.
See results.json for raw generations, failures, seeds, targets and model identities.
