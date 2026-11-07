import json
import subprocess
import sys

import numpy as np
import onnx
import onnxruntime as ort
import pytest
from PIL import Image


def test_split_is_seeded_content_disjoint(tmp_path):
    from edgevision.data import make_manifest, validate_manifest

    for split in ("train", "val"):
        for kind in ("images", "labels"):
            (tmp_path / kind / split).mkdir(parents=True)
        for i in range(8):
            Image.new("RGB", (32, 24), (i * 10, 20, 0 if split == "train" else 255)).save(
                tmp_path / "images" / split / f"{i}.png"
            )
            (tmp_path / "labels" / split / f"{i}.txt").write_text("0 0.5 0.5 0.4 0.4\n")
    a = make_manifest(tmp_path, ["helmet"], seed=42, calibration_count=2)
    assert a == make_manifest(tmp_path, ["helmet"], seed=42, calibration_count=2)
    assert [len(a[s]) for s in ("train", "calibration", "validation")] == [6, 2, 8]
    validate_manifest(a, tmp_path)
    a["calibration"][0] = a["validation"][0]
    with pytest.raises(ValueError, match="overlap"):
        validate_manifest(a, tmp_path)


def test_coco_metrics_perfect_and_missed():
    from edgevision.benchmark import accuracy

    targets = [{"image_id": 0, "category_id": 0, "bbox": [4, 5, 10, 12]}]
    predictions = [dict(targets[0], score=0.9)]
    assert accuracy(targets, predictions, [0], ["helmet"])["map50_95"] == pytest.approx(1)
    assert accuracy(targets, [], [0], ["helmet"])["map50_95"] == 0
    wrong = [dict(predictions[0], bbox=[100, 100, 10, 12])]
    assert accuracy(targets, wrong, [0], ["helmet"])["map50"] == 0


def test_provider_selection_is_explicit():
    from edgevision.runtime import select_providers

    assert select_providers("cpu", ["CPUExecutionProvider"]) == ["CPUExecutionProvider"]
    assert (
        select_providers(
            "auto", ["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
        )[0][0]
        == "TensorrtExecutionProvider"
    )
    with pytest.raises(RuntimeError, match="unavailable"):
        select_providers("tensorrt", ["CPUExecutionProvider"])


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    from edgevision.pipeline import export_model, quantize_model
    from ultralytics import YOLO
    import torch

    torch.manual_seed(42)
    root = tmp_path_factory.mktemp("onnx")
    model = YOLO("yolov8n.yaml")
    model.save(root / "test.pt")
    fp32 = export_model(root / "test.pt", root / "fp32.onnx", 64)
    samples = [np.random.default_rng(i).random((1, 3, 64, 64), dtype=np.float32) for i in range(4)]
    int8 = quantize_model(fp32, root / "int8.onnx", samples)
    return root, fp32, int8, samples


def test_real_export_quantization_and_parity(exported):
    from edgevision.pipeline import check_export

    root, fp32, int8, samples = exported
    assert check_export(root / "test.pt", fp32, samples[0]) < 1e-3
    graph = onnx.load(int8)
    assert any(n.op_type == "QuantizeLinear" for n in graph.graph.node)
    assert any(t.data_type == onnx.TensorProto.INT8 for t in graph.graph.initializer)
    assert int8.stat().st_size < fp32.stat().st_size * 0.6
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    a = ort.InferenceSession(str(fp32), options, providers=["CPUExecutionProvider"])
    b = ort.InferenceSession(str(int8), options, providers=["CPUExecutionProvider"])
    out = b.run(None, {"images": samples[0]})[0]
    assert out.shape == a.run(None, {"images": samples[0]})[0].shape
    assert np.isfinite(out).all()


def test_benchmark_cli_runs_both_real_models(exported):
    root, fp32, int8, _ = exported
    from edgevision.data import file_hash

    image = root / "images" / "val" / "a.png"
    image.parent.mkdir(parents=True)
    Image.new("RGB", (64, 64), "gray").save(image)
    label = root / "labels" / "val" / "a.txt"
    label.parent.mkdir(parents=True)
    label.write_text("0 0.5 0.5 0.2 0.2\n")
    manifest = {
        "seed": 42,
        "names": [str(i) for i in range(80)],
        "train": [],
        "calibration": [],
        "validation": [
            {
                "image": "images/val/a.png",
                "label": "labels/val/a.txt",
                "sha256": file_hash(image),
                "label_sha256": file_hash(label),
            }
        ],
    }
    (root / "manifest.json").write_text(json.dumps(manifest))
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "edgevision.cli",
            "benchmark",
            "--data",
            str(root),
            "--fp32",
            str(fp32),
            "--int8",
            str(int8),
            "--output",
            str(root / "report.json"),
            "--warmup",
            "1",
            "--repeats",
            "2",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads((root / "report.json").read_text())
    assert report["validation_images"] == 1
    for name in ("fp32", "int8"):
        assert report[name]["latency_ms"]["p50"] > 0
        assert report[name]["map50_95"] == 0
        assert report[name]["providers"] == ["CPUExecutionProvider"]
    assert report["speedup"] > 0


def test_benchmark_rejects_bad_repeat_count():
    from edgevision.benchmark import timing

    with pytest.raises(ValueError, match="positive"):
        timing(lambda: None, warmup=1, repeats=0)


def test_changed_image_and_label_are_rejected(tmp_path):
    from edgevision.data import file_hash, validate_manifest

    image, label = tmp_path / "image.png", tmp_path / "label.txt"
    Image.new("RGB", (20, 10), "red").save(image)
    label.write_text("0 0.5 0.5 0.4 0.4\n")
    row = {
        "image": image.name,
        "label": label.name,
        "sha256": file_hash(image),
        "label_sha256": file_hash(label),
    }
    manifest = {"train": [row], "calibration": [], "validation": []}
    label.write_text("0 0.5 0.5 0.3 0.3\n")
    with pytest.raises(ValueError, match="changed label"):
        validate_manifest(manifest, tmp_path)
    row["label_sha256"] = file_hash(label)
    Image.new("RGB", (20, 10), "blue").save(image)
    with pytest.raises(ValueError, match="changed image"):
        validate_manifest(manifest, tmp_path)


def test_letterbox_decode_returns_original_image_coordinates(tmp_path):
    from edgevision.data import preprocess
    from edgevision.benchmark import decode

    image = tmp_path / "wide.png"
    Image.new("RGB", (100, 50), "red").save(image)
    tensor, geometry = preprocess(image, 64)
    assert tensor.shape == (1, 3, 64, 64)
    assert tensor.dtype == np.float32
    # Original xyxy=(25, 10, 75, 40) becomes xywh=(32,32,32,19.2).
    raw = np.zeros((1, 5, 10), dtype=np.float32)
    raw[0, :, 0] = [32, 32, 32, 19.2, 0.9]
    result = decode(raw, geometry, 1, 0.25)
    assert len(result) == 1
    assert result[0]["bbox"] == pytest.approx([25, 10, 50, 30], abs=1e-4)


def test_high_scoring_false_positive_reduces_ap():
    from edgevision.benchmark import accuracy

    target = {"image_id": 0, "category_id": 0, "bbox": [4, 5, 10, 12]}
    predictions = [dict(target, score=0.8), dict(target, score=0.99, bbox=[80, 80, 10, 12])]
    result = accuracy([target], predictions, [0], ["helmet"])
    assert result["map50_95"] == pytest.approx(0.5)


def test_manifest_rejects_path_escape(tmp_path):
    from edgevision.data import validate_manifest

    row = {"image": "../escape.png", "label": "a.txt", "sha256": "abc", "label_sha256": "abc"}
    with pytest.raises(ValueError, match="escapes"):
        validate_manifest({"train": [row], "calibration": [], "validation": []}, tmp_path)


def test_quantization_refuses_empty_calibration(tmp_path, exported):
    from edgevision.pipeline import quantize_dataset

    (tmp_path / "manifest.json").write_text(
        json.dumps({"train": [], "calibration": [], "validation": [], "names": ["helmet"]})
    )
    with pytest.raises(ValueError, match="empty calibration"):
        quantize_dataset(tmp_path, exported[1], tmp_path / "invalid.onnx")


def test_runtime_trace_proves_cpu_kernels_and_removes_profile(exported, tmp_path, monkeypatch):
    from edgevision.runtime import executed_providers

    monkeypatch.chdir(tmp_path)
    observed = executed_providers(exported[1], exported[3][0], "cpu", 1)
    assert observed["CPUExecutionProvider"] > 0
    assert list(tmp_path.glob("onnxruntime_profile*")) == []


def test_prediction_writes_inspectable_image(exported):
    root, _, int8, _ = exported
    image = root / "predict.png"
    Image.new("RGB", (80, 40), "green").save(image)
    output = root / "annotated.jpg"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "edgevision.cli",
            "predict",
            "--model",
            str(int8),
            "--image",
            str(image),
            "--provider",
            "cpu",
            "--output",
            str(output),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert Image.open(output).size == (80, 40)
    assert json.loads(result.stdout)["providers"] == ["CPUExecutionProvider"]


def test_training_config_is_regenerated_from_authoritative_manifest(tmp_path):
    from edgevision.data import write_training_config

    (tmp_path / "train.txt").write_text("/untrusted/validation.png\n")
    (tmp_path / "experiment.yaml").write_text("train: /untrusted/validation.png\n")
    manifest = {"train": [{"image": "images/train/actual.png"}], "names": ["helmet"]}
    config = write_training_config(tmp_path, manifest)
    import yaml

    document = yaml.safe_load(config.read_text())
    assert document["train"] == str((tmp_path / "train.txt").resolve())
    assert document["val"] == document["train"]
    assert (tmp_path / "train.txt").read_text() == str(
        (tmp_path / "images/train/actual.png").resolve()
    ) + "\n"


def test_training_rejects_existing_run_instead_of_returning_stale_weights(tmp_path):
    from edgevision.pipeline import train

    (tmp_path / "train").mkdir()
    with pytest.raises(ValueError, match="already exists"):
        train(tmp_path / "data", tmp_path)


def test_splits_reject_identical_pixels_with_different_metadata(tmp_path):
    from edgevision.data import file_hash, validate_manifest
    from PIL.PngImagePlugin import PngInfo

    image = Image.new("RGB", (20, 10), "red")
    first, duplicate = tmp_path / "first.png", tmp_path / "duplicate.png"
    image.save(first)
    metadata = PngInfo()
    metadata.add_text("note", "different bytes, same pixels")
    image.save(duplicate, pnginfo=metadata)
    label = tmp_path / "labels.txt"
    label.write_text("0 0.5 0.5 0.4 0.4\n")
    rows = [
        {
            "image": p.name,
            "label": label.name,
            "sha256": file_hash(p),
            "label_sha256": file_hash(label),
        }
        for p in (first, duplicate)
    ]
    assert rows[0]["sha256"] != rows[1]["sha256"]
    with pytest.raises(ValueError, match="overlap"):
        validate_manifest(
            {"train": [rows[0]], "calibration": [rows[1]], "validation": []}, tmp_path
        )


def test_tensorrt_int8_flag_only_for_quantized_graph():
    from edgevision.runtime import select_providers

    available = ["TensorrtExecutionProvider", "CPUExecutionProvider"]
    assert select_providers("tensorrt", available, quantized=True)[0][1]["trt_int8_enable"]
    assert not select_providers("tensorrt", available, quantized=False)[0][1]["trt_int8_enable"]


def test_int8_runtime_executes_quantized_convolutions(exported):
    from edgevision.runtime import executed_providers

    trace = executed_providers(exported[2], exported[3][0], details=True)
    assert trace["providers"]["CPUExecutionProvider"] > 0
    assert trace["operators"]["QLinearConv"] > 0
