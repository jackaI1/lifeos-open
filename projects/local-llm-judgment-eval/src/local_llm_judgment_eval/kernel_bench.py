"""Seeded timing of the reference and fused scoring paths at several batch sizes.

Run it on the GPU workstation with ``judgment-eval bench-kernel --device cuda``. On a machine
without CUDA it times only the reference path and records the fused path as unavailable, so the
command still works in CI.
"""

import json
import platform
import statistics
import time
from functools import partial
from pathlib import Path

from .kernels import fused_score, reference_score, triton_available


def _sync(device: str):
    import torch

    if device.startswith("cuda"):
        torch.cuda.synchronize()
    elif device == "mps":
        torch.mps.synchronize()


def _inputs(batch: int, choices: int, device: str, seed: int):
    import torch

    gen = torch.Generator(device="cpu").manual_seed(seed + batch)
    logits = (torch.randn(batch, choices, generator=gen) * 4).to(device)
    targets = torch.softmax(torch.randn(batch, choices, generator=gen), dim=-1).to(device)
    return logits, targets


def _median_ms(fn, device: str, repeats: int) -> float:
    fn()  # warm-up, including Triton compilation
    _sync(device)
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        _sync(device)
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


def run_kernel_benchmark(
    *,
    batch_sizes: list[int],
    choices: int = 4,
    temperature: float = 0.8,
    device: str = "cpu",
    repeats: int = 20,
    seed: int = 42,
) -> dict:
    if not batch_sizes or any(b < 1 for b in batch_sizes):
        raise ValueError("batch sizes must be positive")
    if repeats < 1:
        raise ValueError("repeats must be positive")
    import torch

    fused_ready = device.startswith("cuda") and triton_available()
    rows = []
    for batch in batch_sizes:
        logits, targets = _inputs(batch, choices, device, seed)
        ref_probs, ref_score = reference_score(logits, targets, temperature)
        row = {
            "batch_size": batch,
            "reference_ms": _median_ms(
                partial(reference_score, logits, targets, temperature), device, repeats
            ),
            "fused_ms": None,
            "speedup": None,
            "max_abs_diff_probs": None,
            "max_abs_diff_score": None,
            "fused_status": "not run: needs CUDA and Triton",
        }
        if fused_ready:
            fused_probs, fused_score_out = fused_score(logits, targets, temperature)
            row["max_abs_diff_probs"] = float((fused_probs - ref_probs).abs().max())
            row["max_abs_diff_score"] = float((fused_score_out - ref_score).abs().max())
            row["fused_ms"] = _median_ms(
                partial(fused_score, logits, targets, temperature), device, repeats
            )
            row["speedup"] = row["reference_ms"] / row["fused_ms"]
            row["fused_status"] = "ok"
        rows.append(row)
    return {
        "schema_version": 1,
        "benchmark": "soft cross-entropy over typed choices",
        "device": device,
        "device_name": torch.cuda.get_device_name(0) if fused_ready else None,
        "choices": choices,
        "temperature": temperature,
        "seed": seed,
        "repeats": repeats,
        "torch": torch.__version__,
        "triton_available": triton_available(),
        "python": platform.python_version(),
        "rows": rows,
    }


def write_kernel_report(result: dict, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "kernel_bench.json").write_text(
        json.dumps(result, indent=2, allow_nan=False) + "\n"
    )
    lines = [
        "# Scoring kernel benchmark",
        "",
        f"Device: {result['device']} {result['device_name'] or ''}".rstrip(),
        f"Choices per row: {result['choices']}, temperature {result['temperature']}, "
        f"seed {result['seed']}, median of {result['repeats']} runs.",
        "",
        "| Batch | Reference ms | Fused ms | Speed-up | Max diff probs | Max diff score |",
        "| --- | --- | --- | --- | --- | --- |",
    ]

    def fmt(value, spec, suffix=""):
        return "n/a" if value is None else format(value, spec) + suffix

    for row in result["rows"]:
        lines.append(
            f"| {row['batch_size']} | {fmt(row['reference_ms'], '.3f')} | "
            f"{fmt(row['fused_ms'], '.3f')} | {fmt(row['speedup'], '.2f', 'x')} | "
            f"{fmt(row['max_abs_diff_probs'], '.2e')} | "
            f"{fmt(row['max_abs_diff_score'], '.2e')} |"
        )
    lines += [
        "",
        "n/a means the fused path did not run on this machine; it is never reported as zero.",
        "",
    ]
    (directory / "kernel_bench.md").write_text("\n".join(lines))
