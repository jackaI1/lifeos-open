"""COCO mAP and warm, batch-one model inference timing on identical images."""

import contextlib
import io
import json
import platform
import time
from importlib.metadata import version
from pathlib import Path

import numpy as np
import torch
from pycocotools.coco import COCO
from pycocotools.cocoeval import COCOeval
from ultralytics.utils.nms import non_max_suppression

from .data import file_hash, load_manifest, preprocess
from .runtime import executed_providers, session


def accuracy(targets, predictions, image_ids, names):
    """Standard 101-point COCO AP over IoU=.50:.05:.95, max 100 detections."""
    if not targets:
        raise ValueError("validation has no labeled objects")
    if not predictions:
        return {"map50": 0.0, "map50_95": 0.0, "per_class_map50_95": {}}
    truth = COCO()
    truth.dataset = {
        "info": {},
        "images": [{"id": i} for i in image_ids],
        "categories": [{"id": i, "name": n} for i, n in enumerate(names)],
        "annotations": [
            dict(r, id=i + 1, area=r["bbox"][2] * r["bbox"][3], iscrowd=0)
            for i, r in enumerate(targets)
        ],
    }
    with contextlib.redirect_stdout(io.StringIO()):
        truth.createIndex()
        result = truth.loadRes(predictions)
        evaluator = COCOeval(truth, result, "bbox")
        evaluator.params.imgIds = image_ids
        evaluator.evaluate()
        evaluator.accumulate()
        evaluator.summarize()
    per_class = {}
    precision = evaluator.eval["precision"]  # IoU, recall, class, area, maxDets
    for i, name in enumerate(names):
        values = precision[:, :, i, 0, -1]
        valid = values[values >= 0]
        if len(valid):
            per_class[name] = float(valid.mean())
    return {
        "map50": float(evaluator.stats[1]),
        "map50_95": float(evaluator.stats[0]),
        "per_class_map50_95": per_class,
    }


def decode(raw, geometry, classes, confidence=0.001):
    w, h, sx, sy, left, top = geometry
    # Use identical postprocessing for FP32 and INT8. Raw YOLO output is xywh
    # followed by class probabilities, with no objectness column in YOLOv8.
    detections = non_max_suppression(
        torch.from_numpy(raw.copy()), conf_thres=confidence, iou_thres=0.7, nc=classes, max_det=100
    )[0].numpy()
    result = []
    for x1, y1, x2, y2, score, category in detections:
        x1, x2 = np.clip([(x1 - left) / sx, (x2 - left) / sx], 0, w)
        y1, y2 = np.clip([(y1 - top) / sy, (y2 - top) / sy], 0, h)
        if x2 > x1 and y2 > y1:
            result.append(
                {
                    "category_id": int(category),
                    "score": float(score),
                    "bbox": [float(x1), float(y1), float(x2 - x1), float(y2 - y1)],
                }
            )
    return result


def timing(call, warmup=10, repeats=100):
    if repeats < 1 or warmup < 0:
        raise ValueError("repeats must be positive and warmup nonnegative")
    for _ in range(warmup):
        call()
    elapsed = []
    for _ in range(repeats):
        start = time.perf_counter_ns()
        call()
        elapsed.append((time.perf_counter_ns() - start) / 1e6)
    return {
        "p50": float(np.percentile(elapsed, 50)),
        "p95": float(np.percentile(elapsed, 95)),
        "mean": float(np.mean(elapsed)),
        "samples": repeats,
    }


def benchmark(root, fp32, int8, output, warmup=10, repeats=100, threads=1, provider="cpu"):
    if repeats < 1 or warmup < 0:
        raise ValueError("repeats must be positive and warmup nonnegative")
    manifest = load_manifest(root)
    rows = manifest["validation"]
    if not rows:
        raise ValueError("empty validation split")
    torch.set_num_threads(threads)
    report = {
        "seed": manifest["seed"],
        "validation_images": len(rows),
        "manifest_sha256": file_hash(Path(root) / "manifest.json"),
        "hardware": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "versions": {name: version(name) for name in ("torch", "onnxruntime", "ultralytics")},
        "protocol": {
            "batch": 1,
            "threads": threads,
            "warmup": warmup,
            "repeats": repeats,
            "timed": "session.run only; input/output CPU arrays; cyclic validation inputs",
            "confidence": 0.001,
            "nms_iou": 0.7,
            "max_detections": 100,
        },
    }
    expected_shape = None
    for label, path in [("fp32", fp32), ("int8", int8)]:
        runtime = session(path, provider, threads)
        shape = runtime.get_inputs()[0].shape
        if expected_shape is not None and shape != expected_shape:
            raise ValueError("FP32 and INT8 input shapes differ")
        expected_shape = shape
        size = shape[2]
        targets, predictions, prepared = [], [], []
        for image_id, row in enumerate(rows):
            tensor, geometry = preprocess(Path(root) / row["image"], size)
            prepared.append(tensor)
            raw = runtime.run(None, {"images": tensor})[0]
            predictions.extend(
                dict(p, image_id=image_id) for p in decode(raw, geometry, len(manifest["names"]))
            )
            w, h = geometry[:2]
            for line in (Path(root) / row["label"]).read_text().splitlines():
                if not line.strip():
                    continue
                category, cx, cy, bw, bh = map(float, line.split())
                targets.append(
                    {
                        "image_id": image_id,
                        "category_id": int(category),
                        "bbox": [(cx - bw / 2) * w, (cy - bh / 2) * h, bw * w, bh * h],
                    }
                )
        # Prepared inputs avoid disk I/O and resizing in the timed section.
        cursor = 0

        def infer(runtime=runtime, prepared=prepared):
            nonlocal cursor
            result = runtime.run(None, {"images": prepared[cursor % len(prepared)]})
            cursor += 1
            return result

        latency = timing(infer, warmup, repeats)
        execution = executed_providers(path, prepared[0], provider, threads, details=True)
        report[label] = dict(
            accuracy(targets, predictions, list(range(len(rows))), manifest["names"]),
            latency_ms=latency,
            size_bytes=Path(path).stat().st_size,
            sha256=file_hash(path),
            providers=runtime.get_providers(),
            executed_kernels=execution["providers"],
            executed_operators=execution["operators"],
            input_shape=shape,
            detections=len(predictions),
        )
        del infer, runtime, prepared
    report["speedup"] = report["fp32"]["latency_ms"]["p50"] / report["int8"]["latency_ms"]["p50"]
    report["size_reduction_percent"] = 100 * (
        1 - report["int8"]["size_bytes"] / report["fp32"]["size_bytes"]
    )
    report["map50_95_change"] = report["int8"]["map50_95"] - report["fp32"]["map50_95"]
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(report, indent=2) + "\n")
    return report
