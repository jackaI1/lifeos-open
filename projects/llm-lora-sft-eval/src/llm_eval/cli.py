import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Train extraction adapters and compare held-out outputs"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    data = sub.add_parser("prepare", help="Generate fictional, entity-disjoint records")
    data.add_argument("--output", default="data/intake")
    for name, default in (("train", 512), ("validation", 64), ("test", 128), ("seed", 42)):
        data.add_argument(f"--{name}", type=int, default=default)
    training = sub.add_parser("train", help="Completion-only SFT with LoRA or NF4 QLoRA")
    training.add_argument("--config", required=True)
    training.add_argument("--data", default="data/intake")
    training.add_argument("--output", required=True)
    training.add_argument("--tracking", default="runs/mlruns")
    evaluation = sub.add_parser(
        "evaluate", help="Reload adapters and score the untouched test split"
    )
    evaluation.add_argument("--data", default="data/intake")
    evaluation.add_argument("--adapters", nargs="+", required=True)
    evaluation.add_argument("--output", required=True)
    evaluation.add_argument("--limit", type=int)
    evaluation.add_argument("--bootstrap", type=int, default=2000)
    evaluation.add_argument("--max-new-tokens", type=int, default=96)
    evaluation.add_argument("--tracking", default="runs/mlruns")
    exporting = sub.add_parser("export", help="Save base and merged LoRA weights for serving")
    exporting.add_argument("--adapter", required=True)
    exporting.add_argument("--output", required=True)
    exporting.add_argument("--tracking", default="runs/mlruns")
    serving = sub.add_parser("serve-compare", help="Own two servers, measure quality and speed")
    serving.add_argument("--export", required=True)
    serving.add_argument("--data", default="data/intake")
    serving.add_argument("--output", required=True)
    serving.add_argument("--backend", choices=["vllm", "transformers"], default="transformers")
    serving.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    serving.add_argument("--image", help="Override the pinned vLLM Docker image")
    serving.add_argument("--limit", type=int)
    serving.add_argument("--max-tokens", type=int, default=96)
    serving.add_argument("--concurrency", type=int, default=1)
    serving.add_argument("--warmup", type=int, default=1)
    serving.add_argument("--timeout", type=float, default=120)
    serving.add_argument("--tracking", default="runs/mlruns")
    report = sub.add_parser("report", help="Query MLflow and write CSV, JSON and Markdown")
    report.add_argument("--output", required=True)
    report.add_argument("--tracking", default="runs/mlruns")
    args = parser.parse_args()
    if args.command == "prepare":
        from llm_eval.data import prepare

        result = prepare(args.output, args.train, args.validation, args.test, args.seed)
    elif args.command == "train":
        from llm_eval.model import Config
        from llm_eval.train import train

        result = train(
            Config(**json.loads(Path(args.config).read_text())),
            args.data,
            args.output,
            args.tracking,
        )
    elif args.command == "evaluate":
        from llm_eval.evaluate import evaluate

        result = evaluate(
            args.data,
            args.adapters,
            args.output,
            args.limit,
            args.bootstrap,
            args.tracking,
            args.max_new_tokens,
        )
        result = {"n": result["n"], "runs": result["runs"]}
    elif args.command == "export":
        from llm_eval.export import export

        result = export(args.adapter, args.output, args.tracking)
    elif args.command == "serve-compare":
        from llm_eval.serving import measure

        result = {
            variant: measure(
                args.export,
                variant,
                args.data,
                str(Path(args.output) / variant),
                args.backend,
                args.device,
                args.limit,
                args.max_tokens,
                args.concurrency,
                args.warmup,
                args.tracking,
                args.image,
                args.timeout,
            )
            for variant in ("base", "merged")
        }
    else:
        from llm_eval.report import comparison_report

        result = comparison_report(args.output, args.tracking)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
