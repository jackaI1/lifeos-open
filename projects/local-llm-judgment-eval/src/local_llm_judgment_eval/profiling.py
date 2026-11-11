"""Profile batch sizes and precisions for the Transformers backend on a fixed prompt set.

Each configuration runs the same survey prompts. One warm-up pass runs first, then the measured
pass runs under ``torch.profiler``. The report records time per operator, tokens per second,
prompts per second and peak memory, and compares every configuration with the first one
(``dtypes[0]`` at ``batch_sizes[0]``). It flags changes in outputs, throughput or memory.
"""

import json
import platform
import time
from pathlib import Path

from .resources import MemorySampler

PROFILE_SCHEMA_VERSION = 1
# Relative changes at or above these fractions are flagged for review.
THROUGHPUT_FLAG = 0.10
MEMORY_FLAG = 0.10
TOP_OPS = 10


def _top_ops(profiler, limit: int = TOP_OPS) -> list[dict]:
    averages = sorted(
        profiler.key_averages(), key=lambda event: event.self_cpu_time_total, reverse=True
    )
    return [
        {
            "name": event.key,
            "count": int(event.count),
            "self_cpu_ms": event.self_cpu_time_total / 1000,
            "total_cpu_ms": event.cpu_time_total / 1000,
        }
        for event in averages[:limit]
    ]


def _device_peak_mib(backend) -> float | None:
    return backend.device_memory_mib() if hasattr(backend, "device_memory_mib") else None


def profile_backend(
    backend,
    prompts: list[str],
    *,
    batch_size: int,
    seed: int = 42,
) -> dict:
    """Run one batch-size configuration under torch.profiler and return its measurements."""
    import torch
    from torch.profiler import ProfilerActivity, profile

    if batch_size < 1:
        raise ValueError("batch size must be positive")
    batches = [prompts[i : i + batch_size] for i in range(0, len(prompts), batch_size)]
    backend.generate_batch(batches[0], seed)  # warm-up: allocations, kernels, caches
    if backend.device.startswith("cuda"):
        torch.cuda.reset_peak_memory_stats()
    activities = [ProfilerActivity.CPU]
    if backend.device.startswith("cuda"):
        activities.append(ProfilerActivity.CUDA)

    texts, tokens = [], []
    with MemorySampler() as memory, profile(activities=activities) as prof:
        start = time.perf_counter()
        for batch in batches:
            batch_texts, batch_tokens = backend.generate_batch(batch, seed)
            texts += batch_texts
            tokens += batch_tokens
        wall = time.perf_counter() - start
    return {
        "batch_size": batch_size,
        "batches": len(batches),
        "prompts": len(prompts),
        "generated_tokens": sum(tokens),
        "wall_s": wall,
        "tokens_per_s": sum(tokens) / wall if wall > 0 else None,
        "prompts_per_s": len(prompts) / wall if wall > 0 else None,
        "peak_client_rss_mib": memory.client_peak,
        "device_peak_mib": _device_peak_mib(backend),
        "top_ops": _top_ops(prof),
        "outputs": texts,
    }


def _relative(value: float | None, base: float | None) -> float | None:
    if value is None or base in (None, 0):
        return None
    return (value - base) / base


def flag_changes(configs: list[dict]) -> list[str]:
    """Compare each configuration with the first one and explain every large change."""
    if len(configs) < 2:
        return []
    base = configs[0]
    base_label = f"{base['dtype']} batch {base['batch_size']}"
    flags = []
    for config in configs[1:]:
        label = f"{config['dtype']} batch {config['batch_size']}"
        changed = sum(a != b for a, b in zip(base["outputs"], config["outputs"], strict=True))
        if changed:
            flags.append(
                f"{label}: outputs changed for {changed} of {len(config['outputs'])} prompts "
                f"versus {base_label}"
            )
        throughput = _relative(config["tokens_per_s"], base["tokens_per_s"])
        if throughput is not None and abs(throughput) >= THROUGHPUT_FLAG:
            flags.append(f"{label}: tokens/s changed {throughput:+.0%} versus {base_label}")
        memory_base = base["device_peak_mib"] or base["peak_client_rss_mib"]
        memory_now = config["device_peak_mib"] or config["peak_client_rss_mib"]
        memory = _relative(memory_now, memory_base)
        if memory is not None and abs(memory) >= MEMORY_FLAG:
            flags.append(f"{label}: peak memory changed {memory:+.0%} versus {base_label}")
    return flags


def run_profile(
    backend_factory,
    prompts: list[str],
    *,
    dtypes: list[str],
    batch_sizes: list[int],
    seed: int = 42,
    metadata: dict | None = None,
) -> dict:
    """Profile every dtype and batch size. ``backend_factory(dtype)`` loads one model per dtype."""
    if not dtypes or not batch_sizes or not prompts:
        raise ValueError("dtypes, batch sizes and prompts must all be non-empty")
    configs = []
    model_info = {}
    for dtype in dtypes:
        backend = backend_factory(dtype)
        if not model_info:
            model_info = backend.metadata  # identity of the baseline model
        for batch_size in batch_sizes:
            result = profile_backend(backend, prompts, batch_size=batch_size, seed=seed)
            result["dtype"] = dtype
            result["device"] = backend.device
            configs.append(result)
    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "model": {**model_info, **(metadata or {})},
        "environment": {"python": platform.python_version(), "platform": platform.system()},
        "config": {
            "dtypes": dtypes,
            "batch_sizes": batch_sizes,
            "prompt_count": len(prompts),
            "prompt_sha256": _prompt_digest(prompts),
            "seed": seed,
            "baseline": f"{dtypes[0]} batch {batch_sizes[0]}",
        },
        "configs": configs,
        "flags": flag_changes(configs),
    }


def _prompt_digest(prompts: list[str]) -> str:
    import hashlib

    return hashlib.sha256("\n".join(prompts).encode()).hexdigest()


def write_profile_report(report: dict, directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    # Outputs are kept in JSON only, so the markdown table stays readable.
    (directory / "profile.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    lines = [
        "# Model setting profile",
        "",
        f"Model: {report['model'].get('model')} at revision {report['model'].get('revision')}, "
        f"device {report['model'].get('device')}. Baseline: {report['config']['baseline']}.",
        f"Prompts: {report['config']['prompt_count']} survey prompts, same set for every row.",
        "",
        "| Dtype | Batch | Tokens/s | Prompts/s | Wall s | Peak client RSS MiB | Device peak MiB |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in report["configs"]:
        device = "n/a" if c["device_peak_mib"] is None else f"{c['device_peak_mib']:.1f}"
        lines.append(
            f"| {c['dtype']} | {c['batch_size']} | {c['tokens_per_s']:.2f} | "
            f"{c['prompts_per_s']:.3f} | {c['wall_s']:.2f} | "
            f"{c['peak_client_rss_mib']:.1f} | {device} |"
        )
    lines += ["", "## Flags", ""]
    lines += [f"- {flag}" for flag in report["flags"]] or ["- No changes above the thresholds."]
    lines += [
        "",
        f"Thresholds: tokens/s and memory changes of {THROUGHPUT_FLAG:.0%} or more. "
        "Operator times are CPU self time from torch.profiler; see profile.json for the top "
        "operators of every configuration.",
        "",
        "## Top operators (baseline)",
        "",
        "| Operator | Count | Self CPU ms | Total CPU ms |",
        "| --- | --- | --- | --- |",
    ]
    for op in report["configs"][0]["top_ops"][:5]:
        lines.append(
            f"| {op['name']} | {op['count']} | {op['self_cpu_ms']:.2f} | {op['total_cpu_ms']:.2f} |"
        )
    lines.append("")
    (directory / "profile.md").write_text("\n".join(lines))
