# Training and evaluation design

## Frozen base and completion-only learning

I use Transformers `AutoModelForCausalLM` and `Trainer`, Datasets JSON loading and mapping, and PEFT `LoraConfig`/`get_peft_model`. The exact model revision is `12fd25f77366fa6b3b4b768ec3050bf629380bac`. Rank-8 adapters target query and value projections; alpha is 16 and dropout is 0.05. PEFT freezes base weights. For QLoRA, `BitsAndBytesConfig` uses NF4, double quantization and the selected compute dtype; `prepare_model_for_kbit_training` prepares the frozen base before adapter injection. I count actual `Linear4bit` layers and fail if none are present.

The model's chat template builds the same system/user prefix for training and generation. The answer JSON and EOS are appended as tokens; prefix and padding labels are -100, which excludes them from the loss. A genuine EOS remains supervised even if its token ID also represents padding. Oversize examples raise an error rather than silently dropping the answer. Validation loss uses the same completion mask. No held-out answers inform training, hyperparameter selection or checkpoint selection.

The CPU recipe uses 80 AdamW steps at learning rate 0.0005, batch two, accumulation four (effective batch eight), cosine decay and a 5% warmup. CUDA defaults to 200 steps, effective batch 16, bf16 when supported or fp16 otherwise. Gradient checkpointing recomputes activations to trade time for memory. The provided CUDA recipes are executable configurations, not a claim that a GPU run was measured. CPU runs stay fp32. `run.json` records configuration, validation loss, data hashes and before/after hashes of trainable weights. An unchanged adapter is a training failure.

## Evaluation and uncertainty

I reload the pinned original model and each saved adapter independently. Every variant sees identical row IDs, prompts, greedy decoding and the same new-token budget (96 by default). QLoRA is also compared with the NF4 base without an adapter. This separates the effect of quantization from adapter training. Evaluation refuses adapters with different model revisions, seeds or data manifests.

The parser accepts one entire JSON object, exactly four keys, and string/null values. It does not repair malformed output, strip markdown fences or search for convenient substrings. Exact match compares parsed dictionaries, independent of JSON key order and whitespace. Field-level micro F1 treats each (key, value) as a pair: TP is the number of correct pairs, FP and FN are each four minus TP, so F1 = TP/4. Invalid output gets zero on every field. Per-field accuracy and valid-JSON rate are reported too. A wrong member ID loses credit even if other fields are right.

Each metric gets 2,000 deterministic resamples with replacement and the 2.5th/97.5th percentiles. Paired differences resample row-wise score differences, not two independent sets of scores. I also provide a cluster bootstrap: average the two variants within a member, then resample members. With complete pairs its mean equals the row mean; with a truncated test prefix it weights each represented member equally. Prefer the entity interval for conclusions because variants are correlated. These intervals describe sampling uncertainty conditional on one trained adapter, not variability across training seeds. Degenerate all-zero intervals on a small test are not proof of zero population performance.

`predictions.jsonl` preserves every input, expected answer, raw generated answer and score. `failures.md` lists every failed exact match. `metrics.json` includes row IDs, manifest, model revision, generation settings, training metadata, bootstrap settings and paired comparisons. MLflow stores local run parameters, numerical metrics and artifacts, with explicit links to training run IDs in the report. No tracking service is required.

## References

I followed the primary [Transformers Trainer documentation](https://huggingface.co/docs/transformers/v4.57.1/en/main_classes/trainer), [PEFT quantization guide](https://huggingface.co/docs/peft/developer_guides/quantization) and [bitsandbytes 0.48.2 installation guide](https://huggingface.co/docs/bitsandbytes/v0.48.2/en/installation). The pinned bitsandbytes backend supports CPU QLoRA on Linux x86-64; this repository does not substitute ordinary LoRA when four-bit loading fails.
