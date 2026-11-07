"""A paired experiment: baseline, changed assumptions, then changed allocation."""

import hashlib
import json
from pathlib import Path

import numpy as np

from alm_model.liabilities import liability_stream, present_value, test_coverage
from alm_model.model import ASSETS, calibrate, load_history, optimize

FIELDS = {
    "history",
    "scenarios",
    "seed",
    "years",
    "initial_assets",
    "first_payment",
    "payment_growth",
    "discount_rate",
    "target_return",
    "max_weight",
    "correlation_blend",
}


def load_config(path: str | Path) -> dict:
    path = Path(path)
    config = json.loads(path.read_text())
    if not isinstance(config, dict) or set(config) != FIELDS:
        raise ValueError(f"config must have exactly these keys: {', '.join(sorted(FIELDS))}")
    if not isinstance(config["history"], str) or not config["history"]:
        raise ValueError("history must be a CSV path")
    config["history"] = str((path.parent / config["history"]).resolve())
    return config


def validate_config(config: dict):
    for key, low, high in (("scenarios", 2, 250000), ("years", 1, 100), ("seed", 0, 2**32 - 1)):
        value = config[key]
        if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
            raise ValueError(f"{key} must be an integer between {low} and {high}")
    if config["scenarios"] * config["years"] * len(ASSETS) > 8_000_000:
        raise ValueError("scenario cube exceeds 8 million entries; reduce scenarios or years")
    for key in FIELDS - {"history", "scenarios", "years", "seed"}:
        value = config[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value):
            raise ValueError(f"{key} must be a finite number")
    if config["initial_assets"] <= 0:
        raise ValueError("initial_assets must be positive")


def paired_se(values: np.ndarray) -> float:
    return float(np.std(values, ddof=1) / np.sqrt(len(values)))


def reconcile(base, fixed, revised) -> dict:
    """Exact sequential bridge; paired errors describe simulation noise, not model uncertainty."""
    summaries = [x.summary() for x in (base, fixed, revised)]
    paths = {
        "shortfall_probability": "shortfall",
        "expected_pv_unpaid": "pv_unpaid",
        "mean_terminal_assets": "terminal_assets",
        "mean_payment_coverage": "payment_coverage",
    }
    result = {}
    for metric, before in summaries[0].items():
        unchanged_weights, after = summaries[1][metric], summaries[2][metric]
        row = {
            "baseline": before,
            "changed_model_fixed_weights": unchanged_weights,
            "changed_model_reoptimized": after,
            "assumption_effect": unchanged_weights - before,
            "allocation_effect": after - unchanged_weights,
            "total_change": after - before,
            "bridge_residual": (after - before)
            - ((unchanged_weights - before) + (after - unchanged_weights)),
        }
        if metric in paths:
            a, b, c = [x.path_metrics[paths[metric]] for x in (base, fixed, revised)]
            row["paired_mc_standard_error"] = {
                "assumption_effect": paired_se(b - a),
                "allocation_effect": paired_se(c - b),
                "total_change": paired_se(c - a),
            }
        result[metric] = row
    return result


def run_experiment(config: dict) -> dict:
    validate_config(config)
    history_path = Path(config["history"])
    years, returns = load_history(history_path)
    model = calibrate(returns)
    changed = model.stress_correlations(config["correlation_blend"])
    baseline_allocation = optimize(model, config["target_return"], config["max_weight"])
    changed_allocation = optimize(changed, config["target_return"], config["max_weight"])
    payments = liability_stream(config["years"], config["first_payment"], config["payment_growth"])
    liability_pv = present_value(payments, config["discount_rate"])
    shocks = np.random.default_rng(config["seed"]).standard_normal(
        (config["scenarios"], config["years"], len(ASSETS))
    )

    def evaluate(simulated, weights):
        return test_coverage(
            simulated, weights, payments, config["initial_assets"], config["discount_rate"]
        )

    simulated = model.simulate(shocks)
    baseline = evaluate(simulated, baseline_allocation.weights)
    equal_weight = evaluate(simulated, np.full(len(ASSETS), 1 / len(ASSETS)))
    del simulated
    simulated = changed.simulate(shocks)
    fixed = evaluate(simulated, baseline_allocation.weights)
    revised = evaluate(simulated, changed_allocation.weights)
    del simulated, shocks
    allocations = {}
    for name, allocation in (("baseline", baseline_allocation), ("changed", changed_allocation)):
        allocations[name] = {
            "weights": dict(zip(ASSETS, allocation.weights.tolist(), strict=True)),
            "expected_return": allocation.expected_return,
            "volatility": allocation.volatility,
        }
    # Highest attainable expected return, respecting the cap, for a feasible frontier grid.
    remaining, highest = 1.0, 0.0
    for mean in sorted(model.mean, reverse=True):
        share = min(remaining, config["max_weight"])
        highest += share * mean
        remaining -= share
    frontier = []
    for target in np.linspace(float(model.mean.min()), highest, 8):
        allocation = optimize(model, float(target), config["max_weight"])
        frontier.append(
            {
                "return_floor": float(target),
                "expected_return": allocation.expected_return,
                "volatility": allocation.volatility,
                **dict(zip(ASSETS, allocation.weights.tolist(), strict=True)),
            }
        )
    saved_config = {**config, "history": history_path.name}
    return {
        "schema_version": 1,
        "config": saved_config,
        "data": {
            "file": history_path.name,
            "sha256": hashlib.sha256(history_path.read_bytes()).hexdigest(),
            "first_year": int(years[0]),
            "last_year": int(years[-1]),
            "observations": len(years),
        },
        "calibration": {
            "assets": list(ASSETS),
            "log_mean": model.log_mean.tolist(),
            "log_covariance": model.log_cov.tolist(),
            "arithmetic_mean": model.mean.tolist(),
            "arithmetic_covariance": model.cov.tolist(),
            "baseline_log_correlation": model.correlation.tolist(),
            "changed_log_correlation": changed.correlation.tolist(),
        },
        "liabilities": {
            "present_value": liability_pv,
            "initial_funded_ratio": config["initial_assets"] / liability_pv,
            "payments": payments.tolist(),
        },
        "allocations": allocations,
        "results": {
            "baseline": baseline.summary(),
            "equal_weight_reference": equal_weight.summary(),
            "changed_model_fixed_weights": fixed.summary(),
            "changed_model_reoptimized": revised.summary(),
        },
        "reconciliation": reconcile(baseline, fixed, revised),
        "frontier": frontier,
        "yearly": {
            "baseline": baseline.yearly,
            "changed_model_fixed_weights": fixed.yearly,
            "changed_model_reoptimized": revised.yearly,
        },
    }
