"""CLI for a zero-download smoke run, real model runs, profiling, kernel timing and registry."""

import argparse
import json
from pathlib import Path

from .backends import (
    DEFAULT_MODEL,
    DEFAULT_REVISION,
    TORCH_DTYPES,
    OllamaBackend,
    TransformersBackend,
    VLLMBackend,
)
from .data import SURVEY_SHA256, load_survey
from .runner import batch_throughput, evaluate, write_reports


def build_backend(args):
    """Create the backend named by the CLI flags. Used by ``run`` and by ``run --champion``."""
    if args.backend == "ollama":
        if args.adapter:
            raise ValueError("--adapter is supported by Transformers only")
        return OllamaBackend(
            args.model or "qwen2.5:0.5b",
            url=args.ollama_url,
            server_pid=args.ollama_pid,
            temperature=args.temperature,
        )
    if args.backend == "vllm":
        if args.adapter:
            raise ValueError("--adapter is supported by Transformers only")
        return VLLMBackend(
            args.model or DEFAULT_MODEL,
            revision=args.revision,
            url=args.vllm_url,
            temperature=args.temperature,
        )
    return TransformersBackend(
        args.model or DEFAULT_MODEL,
        revision=args.revision,
        adapter=args.adapter,
        device=args.device,
        dtype=args.dtype,
        temperature=args.temperature,
    )


def backend_from_champion(config: dict, args):
    """Rebuild the registered champion's backend, so the feature runs the promoted model."""
    kind = config["backend"]
    if kind == "ollama":
        return OllamaBackend(config["model"], url=config.get("url", args.ollama_url))
    if kind == "vllm":
        return VLLMBackend(
            config["model"], revision=config["revision"], url=config.get("url", args.vllm_url)
        )
    if kind != "transformers":
        raise ValueError(f"the champion uses backend {kind!r}, which cannot be rebuilt here")
    return TransformersBackend(
        config["model"],
        revision=config["revision"],
        device=config.get("device", "cpu"),
        dtype=config.get("dtype", "float32"),
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify-data", help="verify bundled survey bytes and schema")
    baseline = sub.add_parser(
        "baseline", help="evaluate a uniform reference, without downloading models"
    )
    baseline.add_argument("--output", type=Path, default=Path("artifacts/baseline"))
    train = sub.add_parser("train", help="train a small formatting-only LoRA adapter")
    train.add_argument("--output", type=Path, default=Path("artifacts/format-lora"))
    train.add_argument("--steps", type=int, default=12)
    run = sub.add_parser("run", help="evaluate an installed/downloadable local model")
    run.add_argument("--backend", choices=["ollama", "transformers", "vllm"])
    run.add_argument("--champion", action="store_true", help="use the MLflow champion model")
    run.add_argument("--model", help="Ollama tag, vLLM model ID or Hugging Face model ID")
    run.add_argument("--adapter", type=Path)
    run.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    run.add_argument("--vllm-url", default="http://127.0.0.1:8000")
    run.add_argument(
        "--ollama-pid", type=int, help="measure this explicitly identified server process tree"
    )
    run.add_argument(
        "--batch-concurrency",
        type=int,
        default=0,
        help="also measure batch throughput with this many requests in flight (0 = skip)",
    )
    run.add_argument("--tracking-uri", help="MLflow URI for --champion")
    run.add_argument("--output", type=Path, required=True)
    for p in (baseline, run):
        p.add_argument(
            "--confidence-threshold",
            type=float,
            default=0.4,
            help="route predictions below this maximum answer probability to review",
        )
        p.add_argument("--repeats", type=int, default=3)
        p.add_argument("--max-attempts", type=int, default=3)
        p.add_argument("--cases", nargs="+", help="case IDs; default: all nine")
    baseline.add_argument("--seed", type=int, default=42)
    compare = sub.add_parser("compare", help="combine saved results into a comparison report")
    compare.add_argument("results", nargs="+", type=Path)
    compare.add_argument("--output", type=Path, required=True)
    profile = sub.add_parser(
        "profile", help="profile batch sizes and precisions on a fixed survey prompt set"
    )
    profile.add_argument("--model", default=DEFAULT_MODEL)
    profile.add_argument("--dtypes", nargs="+", choices=TORCH_DTYPES, default=["float32"])
    profile.add_argument("--batch-sizes", nargs="+", type=int, default=[1, 4])
    profile.add_argument("--cases", nargs="+", help="case IDs; default: all nine")
    profile.add_argument("--output", type=Path, default=Path("artifacts/profile"))
    kernel = sub.add_parser("bench-kernel", help="time the reference and fused scoring paths")
    kernel.add_argument("--batch-sizes", nargs="+", type=int, default=[1024, 16384, 131072])
    kernel.add_argument("--choices", type=int, default=4)
    kernel.add_argument("--temperature", type=float, default=0.8)
    kernel.add_argument("--device", default="cpu")
    kernel.add_argument("--repeats", type=int, default=20)
    kernel.add_argument("--seed", type=int, default=42)
    kernel.add_argument("--output", type=Path, default=Path("artifacts/kernel"))
    log = sub.add_parser("log", help="log a results.json file as MLflow runs")
    log.add_argument("results", type=Path)
    log.add_argument("--experiment", default="local-judgment-eval")
    log.add_argument("--tracking-uri")
    registry = sub.add_parser("registry", help="register, promote and roll back the champion")
    reg_sub = registry.add_subparsers(dest="action", required=True)
    for action in ("register", "rollback", "show"):
        p = reg_sub.add_parser(action)
        p.add_argument("--tracking-uri")
        if action == "register":
            p.add_argument("--experiment", default="local-judgment-eval")
            p.add_argument("--metric", default="excess_brier")
            p.add_argument("--min-coverage", type=float, default=0.9)
    promote_cmd = reg_sub.add_parser("promote")
    promote_cmd.add_argument("version", type=int)
    promote_cmd.add_argument("--tracking-uri")
    for p in (train, run, profile):
        p.add_argument("--device", choices=["cpu", "mps", "cuda"], default="cpu")
        p.add_argument(
            "--revision",
            default=DEFAULT_REVISION,
            help="immutable Hugging Face commit; default pins Qwen2.5-0.5B-Instruct",
        )
        p.add_argument("--seed", type=int, default=42)
    run.add_argument("--dtype", choices=TORCH_DTYPES, default="float32")
    for p in (run, profile):
        p.add_argument("--temperature", type=float, default=0.7)
    args = parser.parse_args()
    try:
        if args.command == "verify-data":
            print(f"{len(load_survey().cases)} survey cases verified; SHA-256 {SURVEY_SHA256}")
        elif args.command == "train":
            from .training import train_adapter

            metadata = train_adapter(
                args.output,
                steps=args.steps,
                device=args.device,
                revision=args.revision,
                seed=args.seed,
            )
            print(json.dumps(metadata, indent=2))
        elif args.command == "compare":
            reports = [m for path in args.results for m in json.loads(path.read_text())["models"]]
            signatures = {
                (r["survey_sha256"], json.dumps(r["config"], sort_keys=True)) for r in reports
            }
            if len(signatures) != 1:
                raise ValueError(
                    "comparison requires the same survey, cases, seeds, repeats and retries"
                )
            write_reports(reports, args.output)
            print(f"Comparison written to {args.output}")
        elif args.command == "profile":
            from .profiling import run_profile, write_profile_report
            from .runner import make_prompt

            survey = load_survey()
            cases = [c for c in survey.cases if args.cases is None or c.id in args.cases]
            if not cases:
                raise ValueError("no cases selected")
            prompts = [make_prompt(c) for c in cases]

            def factory(dtype):
                return TransformersBackend(
                    args.model,
                    revision=args.revision,
                    device=args.device,
                    dtype=dtype,
                    temperature=args.temperature,
                )

            report = run_profile(
                factory,
                prompts,
                dtypes=args.dtypes,
                batch_sizes=args.batch_sizes,
                seed=args.seed,
            )
            write_profile_report(report, args.output)
            print("\n".join(report["flags"]) or "No changes above the thresholds.")
            print(f"Profile written to {args.output}")
        elif args.command == "bench-kernel":
            from .kernel_bench import run_kernel_benchmark, write_kernel_report

            result = run_kernel_benchmark(
                batch_sizes=args.batch_sizes,
                choices=args.choices,
                temperature=args.temperature,
                device=args.device,
                repeats=args.repeats,
                seed=args.seed,
            )
            write_kernel_report(result, args.output)
            print(f"Kernel benchmark written to {args.output}")
        elif args.command == "log":
            from .tracking import log_results, tracking_uri_from_env

            run_ids = log_results(
                args.results,
                experiment=args.experiment,
                tracking_uri=args.tracking_uri or tracking_uri_from_env(),
            )
            print(f"Logged {len(run_ids)} MLflow run(s): {', '.join(run_ids)}")
        elif args.command == "registry":
            from . import tracking

            uri = getattr(args, "tracking_uri", None) or tracking.tracking_uri_from_env()
            if args.action == "register":
                result = tracking.register_best(
                    experiment=args.experiment,
                    tracking_uri=uri,
                    metric=args.metric,
                    min_coverage=args.min_coverage,
                )
            elif args.action == "promote":
                result = tracking.promote(args.version, tracking_uri=uri)
            elif args.action == "rollback":
                result = tracking.rollback(tracking_uri=uri)
            else:
                result = {
                    **tracking.champion_status(tracking_uri=uri),
                    "config": tracking.champion_config(tracking_uri=uri),
                }
            print(json.dumps(result, indent=2))
        else:
            if args.command == "baseline":

                class UniformReference:
                    metadata = {"backend": "reference", "model": "uniform, not an LLM"}
                    server_pid = None
                    last_timing = None

                    def generate(self, prompt, schema, seed):
                        return '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}'

                backend = UniformReference()
            elif args.champion:
                from .tracking import champion_config, tracking_uri_from_env

                config = champion_config(tracking_uri=args.tracking_uri or tracking_uri_from_env())
                backend = backend_from_champion(config, args)
            else:
                if not args.backend:
                    raise ValueError("choose --backend or --champion")
                backend = build_backend(args)
            config = {
                "repeats": args.repeats,
                "max_attempts": args.max_attempts,
                "seed": args.seed,
                "case_ids": args.cases,
                "confidence_threshold": args.confidence_threshold,
                "audit_path": args.output / "audit.jsonl",
            }
            result = evaluate(backend, load_survey(), **config)
            if args.command == "run" and args.batch_concurrency > 0:
                result["throughput"] = batch_throughput(
                    backend,
                    load_survey(),
                    concurrency=args.batch_concurrency,
                    seed=args.seed,
                    case_ids=args.cases,
                )
            write_reports([result], args.output)
            print(json.dumps(result["summary"], indent=2))
            if result["summary"]["accepted"] == 0:
                return 2
    except (ValueError, OSError, ImportError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    return 0
