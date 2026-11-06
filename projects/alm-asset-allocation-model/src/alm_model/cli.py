"""Offline CLI and human-readable reports. No server, account, or paid data needed."""

import argparse
import csv
import json
import platform
import sys
from importlib.metadata import version
from pathlib import Path

from alm_model.experiment import load_config, run_experiment


def markdown(report: dict) -> str:
    config, liability = report["config"], report["liabilities"]
    base, changed = report["allocations"]["baseline"], report["allocations"]["changed"]
    lines = [
        "# Allocation and payment coverage",
        "",
        f"{config['scenarios']:,} simulated paths, {config['years']} years, seed {config['seed']}.",
        f"Calibration: {report['data']['first_year']}-{report['data']['last_year']} "
        f"({report['data']['observations']} annual observations). Nominal USD throughout.",
        "",
        f"Starting assets: ${config['initial_assets']:,.0f}. Liability present value: "
        f"${liability['present_value']:,.0f}. Initial funded ratio: "
        f"{liability['initial_funded_ratio']:.1%} (assets divided by discounted payments).",
        "",
        "The optimizer minimizes annual asset variance at the chosen return floor. "
        "It does not minimize missed payments. The separate coverage test checks every payment.",
        "",
        "## Allocation",
        "",
        "| Asset | Baseline | Changed correlations |",
        "|---|---:|---:|",
    ]
    for asset, weight in base["weights"].items():
        lines.append(f"| {asset} | {weight:.2%} | {changed['weights'][asset]:.2%} |")
    lines += [
        "",
        f"Expected annual return: {base['expected_return']:.2%} -> "
        f"{changed['expected_return']:.2%}; annual volatility: {base['volatility']:.2%} -> "
        f"{changed['volatility']:.2%}.",
        "",
        "## Payment coverage",
        "",
        "| Case | Ever miss a payment | Expected unpaid PV | Mean ending assets |",
        "|---|---:|---:|---:|",
    ]
    for case, metrics in report["results"].items():
        lines.append(
            f"| {case} | {metrics['shortfall_probability']:.2%} | "
            f"${metrics['expected_pv_unpaid']:,.2f} | "
            f"${metrics['mean_terminal_assets']:,.2f} |"
        )
    lines += [
        "",
        "## Model-change reconciliation",
        "",
        f"Changed assumption: log-return correlation R becomes "
        f"(1 - {config['correlation_blend']}) R + {config['correlation_blend']} 11'. "
        "Each asset's return distribution stays the same. Shared random draws reduce noise.",
        "",
        "The first effect changes correlations while holding the old allocation. "
        "The second reoptimizes under the new model. Their sum equals the total change. "
        "This is an ordered bridge; reversing the order can give a different attribution.",
        "",
        "| Metric | Assumption effect | Allocation effect | Total change |",
        "|---|---:|---:|---:|",
    ]
    for name, row in report["reconciliation"].items():
        scale = 100 if name in ("shortfall_probability", "mean_payment_coverage") else 1
        unit = " pp" if scale == 100 else " USD"
        cells = [
            f"{row[key] * scale:+,.4f}{unit}"
            for key in ("assumption_effect", "allocation_effect", "total_change")
        ]
        lines.append(f"| {name} | {' | '.join(cells)} |")
    errors = report["reconciliation"]["shortfall_probability"]["paired_mc_standard_error"]
    lines += [
        "",
        "Paired Monte Carlo standard error for the total missed-payment probability "
        f"change: {errors['total_change'] * 100:.4f} percentage points. "
        "This measures sampling noise, not uncertainty about future markets. "
        "The JSON includes paired errors for all mean-based metrics; no error is "
        "estimated for the fifth percentile.",
        "",
        "## Reading the outputs",
        "",
        "- `report.json`: full assumptions, calibration, weights, coverage and reconciliation.",
        "- `yearly.csv`: payments, asset balances and funding ratios for each year and case.",
        "- `frontier.csv`: minimum-variance allocations across eight return floors.",
        "",
        "Historical calibration is an illustration, not a forecast or investment advice. "
        "Independent annual lognormal returns omit fat tails, regime shifts and serial "
        "dependence. Bills use a historical rate proxy. Liabilities are synthetic; "
        "no fees, taxes, contributions, duration hedging or interest-rate revaluation are modeled.",
        "",
    ]
    return "\n".join(lines)


def write_report(report: dict, directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "report.json").write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    (directory / "report.md").write_text(markdown(report))
    for filename, rows in (
        ("frontier.csv", report["frontier"]),
        (
            "yearly.csv",
            [{"case": case, **row} for case, years in report["yearly"].items() for row in years],
        ),
    ):
        with (directory / filename).open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Optimize an allocation and test every liability payment."
    )
    parser.add_argument("--config", type=Path, default=Path("examples/demo.json"))
    parser.add_argument("--output", type=Path, default=Path("reports/latest"))
    parser.add_argument("--scenarios", type=int, help="override scenario count in the config")
    parser.add_argument("--seed", type=int, help="override the fixed random seed")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        for key in ("scenarios", "seed"):
            if getattr(args, key) is not None:
                config[key] = getattr(args, key)
        report = run_experiment(config)
        report["runtime"] = {
            "python": platform.python_version(),
            **{name: version(name) for name in ("numpy", "scipy")},
        }
        write_report(report, args.output)
    except (ValueError, OSError, RuntimeError) as error:
        print(f"alm-model: {error}", file=sys.stderr)
        return 2
    metric = report["results"]["baseline"]["shortfall_probability"]
    print(f"Report: {args.output / 'report.md'}; baseline missed-payment probability: {metric:.2%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
