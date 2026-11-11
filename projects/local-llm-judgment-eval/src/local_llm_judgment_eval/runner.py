"""Auditable repeats, bounded retries and model comparison reports."""

import hashlib
import json
import platform
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean

from .backends import Backend
from .data import SURVEY_SHA256, Case, Survey
from .metrics import distribution_scores, repeat_consistency, soft_ece
from .resources import MemorySampler
from .schema import Prediction, parse_prediction


def make_prompt(case: Case) -> str:
    choices = "\n".join(f"{key}: {case.choices[key]}" for key in "ABCD")
    return (
        f"Population persona: {case.persona}\nQuestion: {case.question}\n{choices}\n"
        "Estimate the probability that a randomly selected person from this population "
        "would give each answer, including no answer. Return ONLY one JSON object with "
        "keys A, B, C, D and numeric values between 0 and 1, summing to exactly 1. "
        "Use at most three decimal places. No explanation or Markdown. "
        'Example of the required format: {"A":0.25,"B":0.25,"C":0.25,"D":0.25}'
    )


def evaluate(
    backend: Backend,
    survey: Survey,
    *,
    repeats: int = 3,
    max_attempts: int = 3,
    seed: int = 42,
    case_ids: list[str] | None = None,
    confidence_threshold: float = 0.4,
    audit_path: Path | None = None,
) -> dict:
    if not 0 <= confidence_threshold <= 1:
        raise ValueError("confidence threshold must be between 0 and 1")
    if repeats < 1 or max_attempts < 1:
        raise ValueError("repeats and max_attempts must be positive")
    if case_ids is not None and (not case_ids or set(case_ids) - {c.id for c in survey.cases}):
        raise ValueError("unknown or empty case selection")
    cases = [c for c in survey.cases if case_ids is None or c.id in case_ids]
    rows = []
    audit = []
    run_id = uuid.uuid4().hex

    def record(event):
        audit.append(event)
        if audit_path is not None:
            audit_path.parent.mkdir(parents=True, exist_ok=True)
            with audit_path.open("a", encoding="utf-8") as log:
                log.write(json.dumps(event, allow_nan=False) + "\n")

    for case in cases:
        for repeat in range(repeats):
            prompt, attempts, prediction = make_prompt(case), [], None
            started = time.perf_counter()
            with MemorySampler(backend.server_pid) as memory:
                for attempt in range(max_attempts):
                    raw, error, error_kind, timing = None, None, None, None
                    attempt_started = time.perf_counter()
                    call_id = uuid.uuid4().hex
                    record(
                        {
                            "event": "started",
                            "run_id": run_id,
                            "call_id": call_id,
                            "timestamp": datetime.now(UTC).isoformat(),
                            "case_id": case.id,
                            "repeat": repeat,
                            "attempt": attempt + 1,
                            "seed": seed + repeat,
                            "model": backend.metadata,
                            "input_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
                        }
                    )
                    try:
                        # The seed is fixed within retries to measure repair, not seed shopping.
                        raw = backend.generate(
                            prompt, Prediction.model_json_schema(), seed + repeat
                        )
                    except (OSError, RuntimeError, ValueError) as exc:
                        error, error_kind = str(exc)[:1000], "backend"
                    else:
                        timing = getattr(backend, "last_timing", None)
                        try:
                            prediction = parse_prediction(raw)
                        except (ValueError, TypeError) as exc:
                            error, error_kind = str(exc)[:1000], "validation"
                    record(
                        {
                            "event": "completed",
                            "run_id": run_id,
                            "call_id": call_id,
                            "timestamp": datetime.now(UTC).isoformat(),
                            "outcome": error_kind or "valid",
                        }
                    )
                    attempts.append(
                        {
                            "attempt": attempt + 1,
                            "raw": raw,
                            "error": error,
                            "error_kind": error_kind,
                            "latency_s": time.perf_counter() - attempt_started,
                            "timing": timing,
                        }
                    )
                    if prediction is not None:
                        break
                    prompt = make_prompt(case) + (
                        "\nYour previous answer failed validation. Return only the four-key "
                        "JSON probability object; check that all values sum to 1."
                    )
            p = prediction.vector() if prediction else None
            confidence = max(p) if p else None
            review = p is None or confidence < confidence_threshold
            rows.append(
                {
                    "case_id": case.id,
                    "repeat": repeat,
                    "seed": seed + repeat,
                    "prediction": p,
                    "confidence": confidence,
                    "review_required": review,
                    "released_prediction": None if review else p,
                    "target": case.target(),
                    "attempts": attempts,
                    "latency_s": time.perf_counter() - started,
                    "peak_client_rss_mib": memory.client_peak,
                    "peak_server_tree_rss_mib": memory.server_peak,
                    "memory_errors": memory.errors,
                    "device_allocated_mib_after_generation": (
                        backend.device_memory_mib()
                        if hasattr(backend, "device_memory_mib")
                        else None
                    ),
                    "scores": distribution_scores(p, case.target()) if p else None,
                }
            )
    valid = [r for r in rows if r["prediction"] is not None]
    metrics = ["brier", "excess_brier", "total_variation", "js_divergence_bits"]
    consistency = [
        repeat_consistency([r["prediction"] for r in valid if r["case_id"] == c.id]) for c in cases
    ]
    repeat_scores = [v for v in consistency if v is not None]
    summary = {key: mean(r["scores"][key] for r in valid) if valid else None for key in metrics}
    timed = [a["timing"] for r in rows for a in r["attempts"] if a.get("timing")]
    generated_s = sum(t["generation_s"] for t in timed)
    generated_tokens = sum(t["completion_tokens"] for t in timed)
    summary.update(
        {
            "planned": len(rows),
            "accepted": len(valid),
            "rejected": len(rows) - len(valid),
            "coverage": len(valid) / len(rows),
            "attempts": sum(len(r["attempts"]) for r in rows),
            "soft_ece": soft_ece([r["prediction"] for r in valid], [r["target"] for r in valid])
            if valid
            else None,
            "repeat_tv": mean(repeat_scores) if repeat_scores else None,
            "repeat_case_coverage": len(repeat_scores) / len(cases),
            "mean_latency_s": mean(r["latency_s"] for r in rows),
            "mean_ttft_s": mean(t["ttft_s"] for t in timed) if timed else None,
            "tokens_per_s": generated_tokens / generated_s if generated_s > 0 else None,
            "peak_client_rss_mib": max(r["peak_client_rss_mib"] for r in rows),
            "peak_server_tree_rss_mib": max(
                (
                    r["peak_server_tree_rss_mib"]
                    for r in rows
                    if r["peak_server_tree_rss_mib"] is not None
                ),
                default=None,
            ),
        }
    )
    return {
        "model": backend.metadata,
        "survey_sha256": SURVEY_SHA256,
        "source_url": survey.source_url,
        "created_at": datetime.now(UTC).isoformat(),
        "environment": {
            "python": platform.python_version(),
            "platform": platform.system(),
            "machine": platform.machine(),
        },
        "config": {
            "repeats": repeats,
            "max_attempts": max_attempts,
            "seed": seed,
            "case_ids": [c.id for c in cases],
            "ece_bins": 10,
            "confidence_threshold": confidence_threshold,
        },
        "summary": summary,
        "audit": audit,
        "category_checks": [
            {
                "case_id": c.id,
                "planned": len(group),
                "review_required": sum(r["review_required"] for r in group),
                "invalid": sum(r["prediction"] is None for r in group),
                "mean_total_variation": mean(
                    r["scores"]["total_variation"] for r in group if r["scores"]
                )
                if any(r["scores"] for r in group)
                else None,
            }
            for c in cases
            for group in [[r for r in rows if r["case_id"] == c.id]]
        ],
        "runs": rows,
    }


def batch_throughput(
    backend,
    survey: Survey,
    *,
    concurrency: int = 1,
    seed: int = 42,
    case_ids: list[str] | None = None,
) -> dict:
    """Send the same typed-probability prompts as the evaluation, ``concurrency`` at a time.

    Wall time covers the whole batch, so ``requests_per_s`` and ``tokens_per_s`` are batch
    throughput rather than single-request speed. Backends that are not thread-safe must use
    concurrency 1.
    """
    if concurrency < 1:
        raise ValueError("concurrency must be positive")
    if concurrency > 1 and not getattr(backend, "thread_safe", False):
        raise ValueError(f"{backend.metadata['backend']} runs one request at a time")
    if not hasattr(backend, "generate_timed"):
        raise ValueError("backend does not report timing")
    cases = [c for c in survey.cases if case_ids is None or c.id in case_ids]
    if not cases:
        raise ValueError("no cases selected")
    schema = Prediction.model_json_schema()
    prompts = [make_prompt(c) for c in cases]

    def call(prompt):
        _, timing = backend.generate_timed(prompt, schema, seed)
        return timing

    start = time.perf_counter()
    if concurrency == 1:
        timings = [call(p) for p in prompts]
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            timings = list(pool.map(call, prompts))
    wall = time.perf_counter() - start
    tokens = sum(t["completion_tokens"] for t in timings)
    return {
        "concurrency": concurrency,
        "requests": len(prompts),
        "wall_s": wall,
        "requests_per_s": len(prompts) / wall,
        "completion_tokens": tokens,
        "tokens_per_s": tokens / wall,
        "mean_ttft_s": mean(t["ttft_s"] for t in timings),
    }


def write_reports(reports: list[dict], directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "results.json").write_text(
        json.dumps({"models": reports}, indent=2, allow_nan=False) + "\n"
    )
    lines = [
        "# Local model comparison",
        "",
        "Lower scores and repeat TV are better. Coverage must be read alongside every score.",
        "Scores are conditional on accepted outputs; rejected runs have no inferred score.",
        "",
        "| Model | Coverage | Brier | Excess Brier | Soft ECE | TV | JS bits | Repeat TV | "
        "Latency s | TTFT s | Tokens/s | Batch req/s | Client RSS MiB | Server tree RSS MiB |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    keys = [
        "brier",
        "excess_brier",
        "soft_ece",
        "total_variation",
        "js_divergence_bits",
        "repeat_tv",
        "mean_latency_s",
        "mean_ttft_s",
        "tokens_per_s",
    ]
    for report in reports:
        model, s = report["model"], report["summary"]
        label = f"{model['backend']}: {model['model']}"
        if model.get("adapter_sha256"):
            label += " + LoRA"
        values = ["n/a" if s[key] is None else f"{s[key]:.4f}" for key in keys]
        batch = report.get("throughput")
        values.append("n/a" if not batch else f"{batch['requests_per_s']:.4f}")
        values += [
            "n/a" if s[key] is None else f"{s[key]:.1f}"
            for key in ("peak_client_rss_mib", "peak_server_tree_rss_mib")
        ]
        lines.append(f"| {label} | {s['accepted']}/{s['planned']} | " + " | ".join(values) + " |")
    lines += [
        "",
        "Latency includes retries and rejected runs. Ollama unloads after every request, "
        "so its timings include cold loads and TTFT includes model load. Transformers load "
        "time is recorded separately. Tokens/s counts generated tokens over generation time "
        "after the first token. Batch req/s comes from the batch throughput run, if requested.",
        "RSS is sampled every 20 ms and may miss short peaks. Server RSS requires an explicit "
        "server PID; n/a never means zero. GPU allocations and RSS are different measures.",
        "Repeat TV uses accepted pairs within a question; JSON records its case coverage.",
        "See results.json for raw generations, failures, seeds, targets and model identities.",
        "",
    ]
    lines += [
        "",
        "## Question category checks",
        "",
        "Each question is a category; differences flag failures for investigation, "
        "not proof of demographic bias.",
        "",
        "| Model | Question | Review / planned | Invalid | Mean TV |",
        "| --- | --- | --- | --- | --- |",
    ]
    for report in reports:
        for c in report.get("category_checks", []):
            tv = "n/a" if c["mean_total_variation"] is None else f"{c['mean_total_variation']:.4f}"
            lines.append(
                f"| {report['model']['model']} | {c['case_id']} | "
                f"{c['review_required']}/{c['planned']} | {c['invalid']} | {tv} |"
            )
    lines += ["", *fastest_line(reports), ""]
    (directory / "comparison.md").write_text("\n".join(lines))


def fastest_line(reports: list[dict], min_coverage: float = 0.9) -> list[str]:
    """Name the fastest model whose typed-output coverage is high enough to trust."""
    eligible = [
        r
        for r in reports
        if r["summary"]["coverage"] >= min_coverage and r["summary"]["mean_latency_s"] is not None
    ]
    if not eligible:
        return [f"No model reached {min_coverage:.0%} typed-output coverage, so none is ranked."]
    best = min(eligible, key=lambda r: r["summary"]["mean_latency_s"])
    s = best["summary"]
    return [
        f"Fastest model with at least {min_coverage:.0%} coverage: "
        f"{best['model']['backend']} {best['model']['model']} "
        f"(mean latency {s['mean_latency_s']:.3f} s, coverage {s['accepted']}/{s['planned']}). "
        "Check its score columns before choosing it."
    ]
