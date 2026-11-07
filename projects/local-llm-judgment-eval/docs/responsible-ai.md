# Model card and risk register

## Model card

This project evaluates predicted distributions of answers to nine published US adult survey questions about AI. It supports local Ollama and Transformers models; the exact model and revision or digest are recorded in each run. The uniform reference is not a model. The intended use is exploratory comparison with the aggregate survey, not predicting an individual's beliefs, making consequential decisions, or establishing demographic fairness. Nine related questions and one aggregate population cannot represent all people or topics. Public survey data may have appeared in model training. The recorded results are conditional on valid outputs, so inspect coverage and category failures alongside scores.

The gate uses the largest predicted answer probability as a simple confidence proxy. It is not calibrated confidence that the prediction is correct: a high value can be wrong and a diffuse distribution can be appropriate. The default 0.4 cutoff is an adjustable screening choice, not a validated safety boundary. Predictions below it and invalid responses have no `released_prediction`; inspect the question, raw attempts, target and scores in `results.json` before deciding whether to use them. No automated approval or decision about a person is made. The original prediction is retained for benchmark analysis, and consumers must use `released_prediction` for gated output.

Each generation attempt writes a start and completion event to `audit.jsonl`, including a unique call ID, model identity, seed, case and SHA-256 hash of the exact prompt. A start without completion signals an interrupted call. The log appends across runs. Hashes are not encryption and known or guessable prompts can be recovered by guessing; avoid sensitive inputs and protect or delete local artifacts as appropriate. `results.json` contains raw responses and survey information, so it is not a privacy-preserving export. A log write failure stops the run; local files are not tamper-proof or a centralized audit system.

## Risk register

| Risk | Control | Remaining limitation |
| --- | --- | --- |
| Incorrect or confident prediction | Compare with survey distributions; review low-confidence and invalid outputs | High confidence can still be wrong; review is manual |
| Uneven performance by topic | Category table reports review, invalid count and mean total variation per question | Small samples; questions are not demographic groups and differences do not prove bias |
| Hidden failures or retries | Log each attempt before and after the call; show coverage and rejected responses | Process crashes may leave an incomplete event pair |
| Sensitive information in artifacts | Hash prompt in audit log; keep outputs local | Hashes can be guessed and results retain raw outputs; do not use personal data |
| Misuse as individual inference | Restrict intended use to aggregate exploratory evaluation | Documentation cannot prevent downstream misuse |
| Stale or unrepresentative evidence | Pin survey checksum and model identity | One 2023 US survey cannot establish present-day or global validity |

For a category check, run the baseline or a model and open `comparison.md`. Compare review counts, invalid counts and mean total variation across question IDs; inspect individual attempts in `results.json` for outliers. The table is a diagnostic starting point, not a statistical test or a demographic fairness audit. Small counts and repeated samples of one question limit interpretation.
