"""Explicit provider policy; CPU numbers never silently use another accelerator."""

import json
import tempfile
from collections import Counter
from pathlib import Path

import onnx
import onnxruntime as ort


def select_providers(mode, available, quantized=False):
    trt = (
        "TensorrtExecutionProvider",
        {"trt_fp16_enable": False, "trt_int8_enable": quantized, "trt_engine_cache_enable": False},
    )
    if mode == "cpu":
        return ["CPUExecutionProvider"]
    if mode == "tensorrt" and "TensorrtExecutionProvider" not in available:
        raise RuntimeError(
            "TensorRT execution provider unavailable; install a compatible GPU runtime"
        )
    if "TensorrtExecutionProvider" in available:
        return (
            [trt]
            + (["CUDAExecutionProvider"] if "CUDAExecutionProvider" in available else [])
            + ["CPUExecutionProvider"]
        )
    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def session(model, provider="cpu", threads=1, profile=False, profile_prefix=None):
    if threads < 1:
        raise ValueError("threads must be positive")
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.enable_profiling = profile
    if profile_prefix:
        options.profile_file_prefix = profile_prefix
    available = ort.get_available_providers()
    quantized = False
    if provider != "cpu" and "TensorrtExecutionProvider" in available:
        quantized = any(n.op_type == "QuantizeLinear" for n in onnx.load(model).graph.node)
    requested = select_providers(provider, available, quantized)
    result = ort.InferenceSession(str(model), options, providers=requested)
    first = requested[0][0] if isinstance(requested[0], tuple) else requested[0]
    if first not in result.get_providers():
        raise RuntimeError(f"{first} failed to initialize; refusing silent provider fallback")
    result.disable_fallback()
    return result


def executed_providers(model, sample, provider="cpu", threads=1, details=False):
    """Trace one separate inference; profiling overhead never enters latency results."""
    with tempfile.TemporaryDirectory(prefix="edgevision-profile-") as directory:
        runtime = session(model, provider, threads, True, str(Path(directory) / "trace"))
        try:
            runtime.run(None, {"images": sample})
        finally:
            trace = runtime.end_profiling()
        events = json.loads(Path(trace).read_text())
        counts = Counter(
            e.get("args", {}).get("provider")
            for e in events
            if e.get("cat") == "Node" and e.get("args", {}).get("provider")
        )
        requested = runtime.get_providers()[0]
        if requested not in counts:
            raise RuntimeError(f"{requested} enabled but executed no graph kernels")
        operators = Counter(
            e.get("args", {}).get("op_name")
            for e in events
            if e.get("cat") == "Node" and e.get("args", {}).get("provider")
        )
        if details:
            return {"providers": dict(counts), "operators": dict(operators)}
        return dict(counts)
