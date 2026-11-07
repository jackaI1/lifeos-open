# edge-vision-quantization

I built a protective-equipment detector to learn how the underlying idea works. This is a learning project.

I fine-tuned a small PyTorch detector for ten epochs using a fixed seed. I exported it to ONNX, a model format that runs outside its training library, then used ONNX Runtime to compress convolution weights and activations from 32-bit floating point (FP32) to 8-bit integers (INT8). Some operations stay in floating point.

| Model | mAP50 | mAP50-95 | Median latency | 95th percentile | ONNX size |
| --- | ---: | ---: | ---: | ---: | ---: |
| FP32 | 49.61% | 31.35% | 32.00 ms | 51.49 ms | 11.56 MiB |
| INT8 | 48.55% | 30.20% | 11.60 ms | 14.07 ms | 3.17 MiB |

On my Apple M5 Pro CPU, INT8 was **72.6% smaller** and **2.76 times faster** by median inference time in this run, at a **1.14 percentage-point** drop in mAP50-95. I would choose it when model storage and CPU response time matter enough to accept that loss. The CPU trace confirms 64 quantized convolution kernels executed.

The accuracy score, mean average precision (mAP), measures whether boxes find the right objects in the right places; higher is better. mAP50-95 is stricter about box placement than mAP50. Latency is the time for one prepared image to pass through the model. It excludes loading a photo, resizing it and drawing boxes. These are measurements on one machine, not a promise about another CPU.

I used 736 training images, 64 separate calibration images to set the INT8 number ranges, and 200 validation images that neither training nor calibration used. The [raw report](results/cpu.json), [exact split and hashes](results/manifest.json), [training history](results/training.csv) and [experiment details](docs/experiment.md) make the comparison inspectable. The public dataset includes both human-collected and generated images; this is not an independent field trial.

## Repeat the comparison

To evaluate accuracy, `prepare` downloads about 648 MB of public images and writes the checked split manifest. I can then benchmark the included models directly:

```bash
uv run edgevision prepare --output data
uv run edgevision benchmark --data data/construction-ppe \
  --fp32 models/fp32.onnx --int8 models/int8.onnx \
  --provider cpu --threads 1 --warmup 10 --repeats 200 \
  --output artifacts/cpu.json
```

Both models use the same images, resizing, box filtering and accuracy calculation. The report includes median and 95th-percentile latency, model byte counts, per-class accuracy, hashes, package versions and the providers that actually executed operations. An execution provider is the ONNX Runtime component that runs the model on a particular processor.

To rebuild the trained models:

```bash
uv run edgevision train --data data/construction-ppe \
  --output artifacts --epochs 10 --size 320 --seed 42 --device cpu
uv run edgevision export --data data/construction-ppe \
  --checkpoint artifacts/train/weights/last.pt --output artifacts/fp32.onnx --size 320
uv run edgevision quantize --data data/construction-ppe \
  --fp32 artifacts/fp32.onnx --output artifacts/int8.onnx
uv run edgevision benchmark --data data/construction-ppe \
  --fp32 artifacts/fp32.onnx --int8 artifacts/int8.onnx --output artifacts/rebuilt.json
```

Training takes longer than using the included models. I use a fresh `--output` directory for each training run. Fixed seeds help repeatability, while different hardware can still produce numerical differences. The export checks its output against PyTorch before quantization. Training lists are regenerated from the verified manifest, and exact duplicate pixels are removed before splitting, even when file metadata differs.

## Optional NVIDIA hardware

On a compatible NVIDIA machine, `--provider auto` selects TensorRT when available, then CUDA, then CPU. `--provider tensorrt` requires TensorRT and fails clearly if it cannot execute the model. The CPU comparison always explicitly uses the CPU.

TensorRT needs a compatible GPU runtime rather than the CPU-only environment above. I describe the setup and Jetson constraints in [the experiment notes](docs/experiment.md#optional-nvidia-execution). I have not measured TensorRT or Jetson on this Mac, so I do not claim a GPU speedup. Provider traces make partial CPU fallback visible.

## Tests and limits

There are 2 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Files omitted from this snapshot:

- models/fp32.onnx (over 10 MB)


Generated output omitted from this copy: results/ (generated output). Regenerate it with the project scripts.

The relocated workflow failed in GitHub Actions and was removed to keep the hub checks independent. Local test sources remain available.

No project-specific GitHub Actions workflow was retained. The local test sources remain in this folder.
