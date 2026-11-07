# How I keep the comparison fair

The detector finds boxes around protective equipment and missing-equipment regions. It is a research prototype for comparing deployment choices, not a safety monitor. Small or hidden equipment is particularly difficult to recognize.

## Data and training

I use the public [Ultralytics Construction-PPE dataset](https://docs.ultralytics.com/datasets/detect/construction-ppe), attributed to the Ultralytics team. The pinned November 2026 release is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), includes human-collected and generated images, and has 12 classes. I do not redistribute its images. The archive checksum in `src/edgevision/data.py` prevents an upstream replacement from silently changing an experiment.

I retain the official validation partition. Before assigning the other images, I remove exact duplicates by decoded RGB pixel SHA-256 (including dimensions), giving validation priority. I shuffle the remaining official training images using seed 42 and reserve 64 for calibration. Calibration measures activation ranges for quantization; those images are not used to fit weights. Every image, decoded pixel array and label has a hash in `results/manifest.json`. This catches exact duplication and file changes, but cannot identify every near-duplicate or shared scene.

I fine-tune the COCO-pretrained YOLOv8 nano detector in PyTorch for ten epochs at 320 by 320 pixels, batch eight, two PyTorch CPU threads, seed 42. The initial weight checksum is checked. Training is deliberately bounded so I can repeat it on a laptop. I use the last checkpoint rather than selecting one using validation. Ultralytics' final internal validation uses only the training image list. The actual held-out partition is first evaluated in the final ONNX comparison. Fixed seeds and deterministic settings aid repeatability; different devices and dependency versions can still change numerical results.

## Export and INT8

The export is batch one, fixed square input, ONNX opset 17, full precision, without embedded suppression. The export command compares raw PyTorch and ONNX output on a calibration image with absolute and relative tolerances of 0.001. I check the graph with the ONNX checker.

ONNX Runtime preprocesses the graph, then performs static quantization using representative calibration inputs. I use per-channel signed INT8 weights and symmetric signed INT8 activations, represented by QuantizeLinear/DequantizeLinear pairs (QDQ). Convolution layers are quantized; other operations and model inputs/outputs stay floating point. The resulting model is mixed precision, not an integer-only executable. Calibration uses the same RGB, aspect-preserving letterbox and 0-to-1 scaling as inference. The temporary preprocessed model is removed even if quantization fails.

## Accuracy

Both models see exactly the same held-out images with identical preprocessing. I decode YOLOv8 boxes, apply class-aware non-maximum suppression (remove overlapping duplicate predictions) at overlap 0.7, and keep up to 100 predictions per image with confidence at least 0.001. Boxes are mapped back into original image coordinates.

The official `pycocotools` evaluator computes average precision using 101 recall points. mAP50 counts boxes at intersection-over-union of at least 0.50. mAP50-95 averages ten overlap thresholds from 0.50 to 0.95 and is stricter about localization. Scores in JSON are fractions; README tables show percentages. Classes absent from validation are excluded by COCO, and per-class results are included when labels exist. Tests verify perfect predictions, missing predictions, wrong boxes and high-confidence false positives.

## Timing

The default comparison explicitly requests CPUExecutionProvider. It uses sequential execution, one intra-op thread, one inter-op thread and batch one. After the accuracy pass, ten warmup runs precede 200 timed inferences cycling through validation tensors. I report median, 95th percentile and mean wall-clock time from `perf_counter_ns` around `session.run`. Disk reads, resizing, box decoding, suppression, session initialization and TensorRT engine construction are excluded. CPU input/output transfer is included. This is model inference latency, not camera-to-alert latency. Models run consecutively, so thermal load and other programs can affect the numbers. File sizes are bytes of the actual ONNX files; speedup is FP32 median divided by INT8 median.

A separate single-inference profile records kernel counts by provider without adding profiling overhead to timed runs. The trace lives in a temporary directory and is removed. Enabled providers and executed providers are both recorded.

## Optional NVIDIA execution

`--provider auto` prefers TensorRT, then CUDA, then CPU according to the installed runtime. `--provider tensorrt` requires TensorRT and errors if it cannot initialize or executes no graph kernels. TensorRT may partition unsupported operations to CUDA or CPU; kernel counts expose that. These providers require an NVIDIA GPU and a compatible ONNX Runtime GPU build, CUDA, cuDNN and TensorRT. On Jetson, use NVIDIA's matching JetPack runtime rather than installing the CPU wheel from this lock file.

In a separate NVIDIA environment, install the package without the CPU runtime dependency, install a compatible `onnxruntime-gpu` build, and verify `onnxruntime.get_available_providers()` contains `TensorrtExecutionProvider`. Then run the same benchmark with `--provider tensorrt --output artifacts/tensorrt.json`. Keep this report separate from the CPU report. QDQ parsing and INT8 acceleration depend on the TensorRT version and GPU. I have not measured Jetson, CUDA or TensorRT performance on this Mac and do not claim a GPU speedup. See the [ONNX Runtime TensorRT setup and compatibility table](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html).

## Repeating the experiment

The README commands rebuild the experiment from public data. `results/` records the exact split, training history, export parity and CPU comparison. The shipped ONNX models allow inference and benchmarking without repeating training. The package versions and transitive dependencies are in `uv.lock`.

CI runs lint, formatting and the full pytest suite on Linux. Tests export a real YOLO model, calibrate and quantize it, check graph types and file reduction, run both models through ONNX Runtime and invoke the benchmark command as a subprocess. Tests use generated images so CI needs neither a dataset download nor GPU. The published detector's real-data run is separate evidence; synthetic fixture accuracy is not presented as trained accuracy.
