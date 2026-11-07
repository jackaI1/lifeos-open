"""PyTorch fine-tuning, ONNX export and representative-data static quantization."""

import json
import random
import shutil
from pathlib import Path

import numpy as np
import onnx
import torch
from onnxruntime.quantization import (
    CalibrationDataReader,
    CalibrationMethod,
    QuantFormat,
    QuantType,
    quantize_static,
)
from onnxruntime.quantization.shape_inference import quant_pre_process
from ultralytics import YOLO

from .data import file_hash, load_manifest, preprocess, write_training_config
from .runtime import session


def train(root, output, epochs=10, size=320, seed=42, device="cpu"):
    if (Path(output) / "train").exists():
        raise ValueError("training run already exists; choose a new --output directory")
    manifest = load_manifest(root)
    config = write_training_config(root, manifest)
    if seed != manifest["seed"]:
        raise ValueError("training seed must match manifest seed")
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(2)
    output = Path(output)
    model = YOLO("yolov8n.pt")
    initial_sha256 = file_hash("yolov8n.pt")
    if initial_sha256 != "f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36":
        raise ValueError("pretrained weights checksum mismatch")
    model.add_callback("on_train_start", lambda trainer: torch.set_num_threads(2))
    model.train(
        data=str(config),
        epochs=epochs,
        imgsz=size,
        batch=8,
        device=device,
        workers=0,
        seed=seed,
        deterministic=True,
        project=str(output),
        name="train",
        exist_ok=False,
        val=False,
        patience=0,
        plots=False,
        save=True,
        amp=False,
        cache=False,
        mosaic=0.0,
        mixup=0.0,
        close_mosaic=0,
    )
    # Last epoch, never a checkpoint chosen using held-out validation accuracy.
    checkpoint = output / "train/weights/last.pt"
    metadata = {
        "seed": seed,
        "epochs": epochs,
        "threads": 2,
        "size": size,
        "device": device,
        "initial_weights": "yolov8n.pt",
        "initial_weights_sha256": initial_sha256,
        "checkpoint_sha256": file_hash(checkpoint),
        "split_counts": {s: len(manifest[s]) for s in ("train", "calibration", "validation")},
    }
    (output / "training.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return checkpoint


def export_model(checkpoint, output, size=320):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    model = YOLO(str(checkpoint))
    exported = Path(
        model.export(
            format="onnx",
            imgsz=size,
            batch=1,
            dynamic=False,
            simplify=False,
            opset=17,
            device="cpu",
            half=False,
        )
    )
    if exported.resolve() != output.resolve():
        shutil.move(exported, output)
    onnx.checker.check_model(str(output))
    return output


def check_export(checkpoint, exported, sample):
    model = YOLO(str(checkpoint)).model.float().eval().fuse()
    with torch.no_grad():
        raw = model(torch.from_numpy(sample))
    expected = raw[0].numpy() if isinstance(raw, tuple) else raw.numpy()
    actual = session(exported).run(None, {"images": sample})[0]
    np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-3)
    return float(np.max(np.abs(actual - expected)))


class Reader(CalibrationDataReader):
    def __init__(self, samples):
        self.samples = iter(samples)

    def get_next(self):
        sample = next(self.samples, None)
        return None if sample is None else {"images": sample}


def quantize_model(fp32, output, samples):
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    preprocessed = output.with_suffix(".prepared.onnx")
    try:
        quant_pre_process(str(fp32), str(preprocessed), skip_symbolic_shape=True)
        quantize_static(
            str(preprocessed),
            str(output),
            Reader(samples),
            quant_format=QuantFormat.QDQ,
            activation_type=QuantType.QInt8,
            weight_type=QuantType.QInt8,
            per_channel=True,
            calibrate_method=CalibrationMethod.MinMax,
            op_types_to_quantize=["Conv"],
            extra_options={"ActivationSymmetric": True, "WeightSymmetric": True},
        )
        graph = onnx.load(output)
        onnx.checker.check_model(graph)
        if not any(n.op_type == "QuantizeLinear" for n in graph.graph.node):
            raise RuntimeError("quantization produced no INT8 operations")
    finally:
        preprocessed.unlink(missing_ok=True)
    return output


def quantize_dataset(root, fp32, output):
    manifest = load_manifest(root)
    if not manifest["calibration"]:
        raise ValueError("empty calibration split")
    size = session(fp32).get_inputs()[0].shape[2]
    return quantize_model(
        fp32,
        output,
        (preprocess(Path(root) / r["image"], size)[0] for r in manifest["calibration"]),
    )
