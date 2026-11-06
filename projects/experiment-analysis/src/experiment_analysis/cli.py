"""Reproducible synthetic demo or analysis of a CSV with the documented schema."""

import argparse
import json
from pathlib import Path

from .ab import plan_sample_size
from .report import write_report
from .simulate import Simulation, simulate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    plan = commands.add_parser("plan", help="Plan per-arm size for an accuracy improvement")
    plan.add_argument("--baseline", type=float, default=0.90)
    plan.add_argument("--improvement", type=float, default=0.03)
    plan.add_argument("--power", type=float, default=0.80)
    demo = commands.add_parser("demo", help="Generate synthetic orders and analyze both designs")
    demo.add_argument(
        "--broken-trends", action="store_true", help="Demonstrate a failed DiD assumption"
    )
    analyze = commands.add_parser("analyze", help="Analyze a CSV; never reads truth.json")
    analyze.add_argument("csv", type=Path)
    analyze.add_argument("--design", choices=["both", "ab", "did"], default="both")
    for sub in (demo, analyze):
        sub.add_argument("--output", type=Path, required=True)
        sub.add_argument("--seed", type=int, default=42)
        sub.add_argument("--draws", type=int, default=2000)
    args = parser.parse_args(argv)
    try:
        if args.command == "plan":
            size = plan_sample_size(args.baseline, args.improvement, args.power)
            print(f"Required orders per arm: {size}")
            return 0
        if args.command == "demo":
            rows, truth = simulate(
                Simulation(
                    seed=args.seed, differential_service_trend=4.0 if args.broken_trends else 0.0
                )
            )
            args.output.mkdir(parents=True, exist_ok=True)
            csv_path = args.output / "orders.csv"
            rows.to_csv(csv_path, index=False)
            (args.output / "truth.json").write_text(json.dumps(truth, indent=2) + "\n")
        else:
            csv_path = args.csv
        results = write_report(
            csv_path,
            args.output,
            design=getattr(args, "design", "both"),
            draws=args.draws,
            seed=args.seed,
            synthetic=args.command == "demo",
        )
    except (ValueError, OSError) as error:
        parser.exit(2, f"error: {error}\n")
    print(results["recommendation"])
    print(f"Report: {args.output / 'report.md'}")
    return 0
