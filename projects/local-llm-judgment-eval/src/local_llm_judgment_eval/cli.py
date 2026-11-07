"""CLI for a zero-download smoke run, real model runs, training and comparison."""

import argparse
import json
from pathlib import Path

from .backends import DEFAULT_MODEL, DEFAULT_REVISION, OllamaBackend, TransformersBackend
from .data import SURVEY_SHA256, load_survey
from .runner import evaluate, write_reports


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
    run.add_argument("--backend", choices=["ollama", "transformers"], required=True)
    run.add_argument("--model", help="Ollama tag or Hugging Face model ID")
    run.add_argument("--adapter", type=Path)
    run.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    run.add_argument(
        "--ollama-pid", type=int, help="measure this explicitly identified server process tree"
    )
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
    run.add_argument("--output", type=Path, required=True)
    compare = sub.add_parser("compare", help="combine saved results into a comparison report")
    compare.add_argument("results", nargs="+", type=Path)
    compare.add_argument("--output", type=Path, required=True)
    for p in (train, run):
        p.add_argument("--device", choices=["cpu", "mps", "cuda"], default="cpu")
        p.add_argument(
            "--revision",
            default=DEFAULT_REVISION,
            help="immutable Hugging Face commit; default pins Qwen2.5-0.5B-Instruct",
        )
        p.add_argument("--seed", type=int, default=42)
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
        else:
            if args.command == "baseline":

                class UniformReference:
                    metadata = {"backend": "reference", "model": "uniform, not an LLM"}
                    server_pid = None

                    def generate(self, prompt, schema, seed):
                        return '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}'

                backend = UniformReference()
            else:
                if args.backend == "ollama":
                    if args.adapter:
                        raise ValueError("--adapter is supported by Transformers only")
                    backend = OllamaBackend(
                        args.model or "qwen2.5:0.5b",
                        url=args.ollama_url,
                        server_pid=args.ollama_pid,
                    )
                else:
                    backend = TransformersBackend(
                        args.model or DEFAULT_MODEL,
                        revision=args.revision,
                        adapter=args.adapter,
                        device=args.device,
                    )
            config = {
                "repeats": args.repeats,
                "max_attempts": args.max_attempts,
                "seed": args.seed,
                "case_ids": args.cases,
                "confidence_threshold": args.confidence_threshold,
                "audit_path": args.output / "audit.jsonl",
            }
            result = evaluate(backend, load_survey(), **config)
            write_reports([result], args.output)
            print(json.dumps(result["summary"], indent=2))
            if result["summary"]["accepted"] == 0:
                return 2
    except (ValueError, OSError, ImportError) as exc:
        parser.exit(1, f"Error: {exc}\n")
    return 0
