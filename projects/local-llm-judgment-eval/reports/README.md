# Recorded local experiment

I ran the small model through both local backends and reloaded the trained adapter before evaluating it. These are actual generations, including the failures. The [comparison](comparison/comparison.md) puts them beside a uniform reference that assigns every answer probability 0.25.

The experiment used all nine survey questions, seeds 42 and 43, two repeats per question and at most two attempts per repeat. There are 54 planned model predictions across three configurations, plus 18 uniform-reference predictions. The machine was an Apple M5 Pro Mac with 24 GiB of unified memory. Transformers and training used MPS, Apple's GPU interface, with float32 weights. Runs were performed on November 5, 2026, on a shared desktop, so latency is an exploratory measurement rather than an isolated speed benchmark. The final Ollama measurement was rerun after training and Transformers evaluation had finished.

| Configuration | Valid predictions | Expected Brier on valid predictions |
| --- | --- | --- |
| Uniform reference | 18/18 | 0.7500 |
| Ollama, small quantized model | 11/18 | 1.3928 |
| Transformers, base model | 0/18 | Not available |
| Transformers, reloaded LoRA adapter | 9/18 | 1.3709 |

The formatting-only adapter made valid outputs possible where the base model failed this strict contract. It did not make these survey predictions good: both configurations with accepted answers scored worse than the uniform reference, and rejection changes which questions contribute to each average. I cannot infer a survey accuracy improvement by comparing the two conditional Brier numbers. All base-model outputs are retained with their errors, rather than given invented scores.

The adapter had 270,336 trainable parameters out of 494,303,104 total parameters including the adapter. Its 12 optimizer steps took 6.25 seconds after setup and model loading. Losses ranged from 0.6512 on the first training example to 0.0738 on the last; those are different examples, so this is a training trace rather than a held-out loss comparison. The nonzero parameter change and saved weights show that optimization happened. Full metadata and weight hashes are in [the saved adapter's training log](../examples/format-lora/training.json).

The base model revision and each configuration's parameters are in its `results.json`. The Ollama report contains the model digest and sampled server-tree RSS. The Transformers reports contain the base revision, device allocation measurements, and the adapter hash where applicable. A missing score means no valid predictions; a missing repeat TV means there were no within-question accepted pairs. Rejections and insufficient pairs must not be read as perfect performance.

To inspect or regenerate the combined report without loading a model:

```bash
uv run judgment-eval compare reports/uniform/results.json reports/ollama/results.json \
  reports/hf-base/results.json reports/hf-lora/results.json --output artifacts/rechecked
```

To repeat inference, follow the README's commands with `--repeats 2 --max-attempts 2`, using `--device mps` on a compatible Mac. The committed adapter can be loaded with `--adapter examples/format-lora`. Hardware, library versions, quantization, model availability and randomness can change results; reproducing the procedure does not promise byte-identical generations.
