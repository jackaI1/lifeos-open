"""The public measurements must describe the actual runnable artifacts."""

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort

from edgevision.data import file_hash

ROOT = Path(__file__).resolve().parents[1]


def test_published_report_matches_models_and_manifest():
    report = json.loads((ROOT / "results/cpu.json").read_text())
    manifest_path = ROOT / "results/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    assert report["manifest_sha256"] == file_hash(manifest_path)
    assert report["validation_images"] == len(manifest["validation"]) == 200
    assert len(manifest["calibration"]) == 64
    hashes = [
        r["pixel_sha256"]
        for split in ("train", "calibration", "validation")
        for r in manifest[split]
    ]
    assert len(hashes) == len(set(hashes))
    assert report["int8"]["executed_operators"]["QLinearConv"] > 0
    for name in ("fp32", "int8"):
        model = ROOT / "models" / f"{name}.onnx"
        assert report[name]["sha256"] == file_hash(model)
        assert report[name]["size_bytes"] == model.stat().st_size
        assert 0 < report[name]["map50_95"] <= report[name]["map50"] <= 1
        assert report[name]["executed_kernels"]["CPUExecutionProvider"] > 0
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        runtime = ort.InferenceSession(str(model), options, providers=["CPUExecutionProvider"])
        shape = runtime.get_inputs()[0].shape
        prediction = runtime.run(None, {"images": np.zeros(shape, dtype=np.float32)})[0]
        assert prediction.shape[1] == 4 + len(manifest["names"])
        assert np.isfinite(prediction).all()
