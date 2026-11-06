"""Machine-readable estimates, a brief decision report and an event-study figure."""

import hashlib
import json
from importlib.metadata import version
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from .ab import analyze_ab
from .did import analyze_did

LABELS = {
    "correct": "Order accuracy",
    "automated": "Automation rate",
    "service_seconds": "Service time",
}


def recommendation(results: dict) -> str:
    ab, did = results.get("ab"), results.get("did")
    if ab and ab["randomization_flag"]:
        return (
            "Hold the change. Investigate assignment or logging before interpreting the A/B result."
        )
    if did and did["diagnostic_flag"]:
        return (
            "Hold the change. The before-and-after comparison has a pre-trend or placebo warning. "
            "Investigate other changes at the adopting locations and run a randomized pilot."
        )
    if ab and not ab["power_plan"]["sample_target_met"]:
        return "Collect more orders to reach the planned A/B sample size before deciding."
    effects = [
        (metric, metric["effect"] * (-1 if metric["metric"] == "service_seconds" else 1))
        for design in (ab, did)
        if design
        for metric in design["metrics"]
    ]
    if any(benefit < 0 and metric["significant"] for metric, benefit in effects):
        return "Hold the change. At least one measured outcome shows evidence of harm."
    if any(not metric["significant"] or benefit <= 0 for metric, benefit in effects):
        return (
            "Keep testing. The evidence does not yet show improvement in all three "
            "outcomes; an inconclusive result does not establish no effect."
        )
    return (
        "Try a limited, monitored rollout. All three outcomes improved in the analyzed designs. "
        "Confirm the result on real orders before a wider rollout."
    )


def _effect(value: float, metric: str) -> str:
    return f"{value:+.2f} s" if metric == "service_seconds" else f"{100 * value:+.2f} pp"


def _plot_events(did: dict, path: Path) -> None:
    fig, axes = plt.subplots(1, 3, figsize=(13, 4), constrained_layout=True)
    try:
        for ax, (metric, events) in zip(axes, did["event_studies"].items(), strict=True):
            frame = pd.DataFrame(events).sort_values("period")
            scale = 1 if metric == "service_seconds" else 100
            ax.errorbar(
                frame.period,
                frame.effect * scale,
                yerr=[
                    (frame.effect - frame.ci_low) * scale,
                    (frame.ci_high - frame.effect) * scale,
                ],
                fmt="o-",
                color="#14615c",
                capsize=3,
            )
            ax.axhline(0, color="0.5", linewidth=0.8)
            ax.axvline(-0.5, color="#b75a37", linestyle="--")
            ax.set(
                title=LABELS[metric],
                xlabel="Week relative to change",
                ylabel="Difference from week -1 (" + ("seconds" if scale == 1 else "pp") + ")",
            )
            ax.grid(axis="y", alpha=0.2)
            ax.set_xticks(sorted({int(frame.period.min()), -4, -1, 0, int(frame.period.max())}))
        fig.suptitle("Location rollout: event estimates and pointwise 95% intervals")
        fig.savefig(path, dpi=160)
    finally:
        plt.close(fig)


def write_report(
    csv_path: Path,
    output: Path,
    *,
    design: str = "both",
    draws: int = 2000,
    seed: int = 42,
    synthetic: bool = False,
) -> dict:
    """Read a CSV and emit reusable artifacts. No simulation truth enters inference."""
    rows = pd.read_csv(csv_path)
    results = {
        "provenance": {
            "input_sha256": hashlib.sha256(csv_path.read_bytes()).hexdigest(),
            "rows": len(rows),
            "synthetic": synthetic,
            "analysis_seed": seed,
            "versions": {
                name: version(name)
                for name in (
                    "experiment-analysis",
                    "numpy",
                    "pandas",
                    "scipy",
                    "statsmodels",
                    "matplotlib",
                )
            },
        }
    }
    if design not in ("ab", "did", "both"):
        raise ValueError("design must be ab, did or both")
    if design in ("ab", "both"):
        results["ab"] = analyze_ab(rows, draws=draws, seed=seed)
    if design in ("did", "both"):
        results["did"] = analyze_did(rows)
    results["recommendation"] = recommendation(results)
    output.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Ordering change report",
        "",
        "Synthetic demonstration; these are not restaurant measurements."
        if synthetic
        else "Imported order data; the program cannot verify assignment or causal assumptions.",
        "",
        f"**Recommendation:** {results['recommendation']}",
        "",
        "Positive accuracy/automation changes and negative service-time changes are better. "
        "pp means percentage points: 90% to 93% is +3 pp.",
        "",
    ]
    for key, title in (
        ("ab", "Randomized orders"),
        ("did", "Location before-and-after comparison"),
    ):
        if key not in results:
            continue
        result = results[key]
        lines += [
            f"## {title}",
            "",
            "| Outcome | Change | 95% interval | Adjusted p |",
            "| --- | ---: | ---: | ---: |",
        ]
        for m in result["metrics"]:
            metric = m["metric"]
            lines.append(
                f"| {LABELS[metric]} | {_effect(m['effect'], metric)} | "
                f"{_effect(m['ci_low'], metric)} to {_effect(m['ci_high'], metric)} | "
                f"{m['p_adjusted']:.4g} |"
            )
        lines += [
            "",
            "Holm correction covers the three outcomes within this design. "
            "Intervals are pointwise 95%, not simultaneous intervals.",
            "",
        ]
        if key == "ab":
            plan = result["power_plan"]
            lines += [
                f"Orders: {result['n_control']:,} control, {result['n_treatment']:,} treatment. "
                f"Accuracy plan: {plan['required_per_arm']:,} per arm for 80% power to detect "
                "90% to 93% accuracy, using a conservative three-outcome adjustment. "
                "This is a fixed plan, not observed power, and does not power every outcome.",
                "",
                "Assignment checks (Holm-adjusted p; warning threshold 0.01):",
                "",
            ]
            lines += [f"- {c['name']}: {c['p_adjusted']:.4g}" for c in result["randomization"]]
        else:
            lines += [
                f"{result['orders']:,} orders, {result['location_periods']} location-weeks; "
                f"{result['metrics'][0]['clusters']} location clusters. Equal weight per "
                "location-week; location and week effects remove fixed differences and "
                "shared weekly changes. Uncertainty allows orders at a location to move together.",
                "",
                "Checks (Holm-adjusted p across all six checks; warning threshold 0.05):",
                "",
            ]
            lines += [
                f"- {LABELS[c['metric']]} {c['check']}: {c['p_adjusted']:.4g}"
                for c in result["diagnostics"]
            ]
            lines += [
                "",
                f"The placebo pretends the change happened at week {result['placebo_cutoff']}, "
                "using only pre-change data. Pre-trends jointly test all weeks before week -1.",
                "",
                "![Event-study estimates](event-study.png)",
            ]
        lines.append("")
    lines += [
        "## Limits",
        "",
        "A quiet diagnostic cannot prove parallel trends or successful "
        "randomization. Location-specific events after rollout can still bias the comparison. "
        "The A/B calculation assumes independent orders with no repeat-customer or "
        "shared-queue effects. This is a single planned analysis, not a tool for repeatedly "
        "peeking until a result becomes significant.",
        "",
        f"Input SHA-256: `{results['provenance']['input_sha256']}`. "
        f"Analysis seed: {seed}. Full estimates and versions: [results.json](results.json).",
        "",
    ]
    # Reject nonfinite estimates before writing any numerical artifact.
    payload = json.dumps(results, indent=2, allow_nan=False) + "\n"
    if "did" in results:
        _plot_events(results["did"], output / "event-study.png")
    (output / "results.json").write_text(payload)
    (output / "report.md").write_text("\n".join(lines))
    return results
