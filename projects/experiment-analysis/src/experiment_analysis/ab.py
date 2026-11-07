"""Order-level, independent two-arm inference, fixed horizon and endpoint family."""

from math import ceil

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.power import NormalIndPower
from statsmodels.stats.proportion import proportion_effectsize, proportions_ztest

from .schema import METRICS, select_design


def plan_sample_size(
    baseline: float = 0.90, improvement: float = 0.03, power: float = 0.80, alpha: float = 0.05
) -> int:
    """Per-arm size for accuracy with conservative Bonferroni alpha for 3 endpoints."""
    if not (0 < baseline < baseline + improvement < 1 and 0 < power < 1 and 0 < alpha < 1):
        raise ValueError("Use valid rates, a positive improvement, and power/alpha in (0,1)")
    effect = abs(proportion_effectsize(baseline + improvement, baseline))
    return ceil(NormalIndPower().solve_power(effect, power=power, alpha=alpha / 3, ratio=1))


def bootstrap_difference(
    control, treatment, *, binary: bool = False, draws: int = 2000, seed: int = 42
) -> dict:
    """Percentile CI and centered-null, two-sided bootstrap test of a mean difference.

    Binary empirical resampling is exactly binomial. Continuous resampling uses
    batches of 32 to avoid an orders-by-all-draws allocation.
    """
    a, b = np.asarray(control, dtype=float), np.asarray(treatment, dtype=float)
    if (
        draws < 999
        or min(len(a), len(b)) < 2
        or not np.isfinite(a).all()
        or not np.isfinite(b).all()
    ):
        raise ValueError("Bootstrap needs >=999 draws and >=2 finite values per arm")
    if binary and (not np.isin(a, [0, 1]).all() or not np.isin(b, [0, 1]).all()):
        raise ValueError("Binary bootstrap values must be 0 or 1")
    rng = np.random.default_rng(seed)
    observed = float(b.mean() - a.mean())
    if binary:
        diffs = rng.binomial(len(b), b.mean(), draws) / len(b)
        diffs -= rng.binomial(len(a), a.mean(), draws) / len(a)
    else:
        diffs = np.empty(draws)
        for start in range(0, draws, 32):
            batch = min(32, draws - start)
            diffs[start : start + batch] = rng.choice(b, (batch, len(b))).mean(axis=1) - rng.choice(
                a, (batch, len(a))
            ).mean(axis=1)
    lo, hi = np.quantile(diffs, [0.025, 0.975])
    # Subtracting the observed difference centers resampling at the null (zero).
    p = (1 + np.count_nonzero(np.abs(diffs - observed) >= abs(observed))) / (draws + 1)
    return {"effect": observed, "ci_low": float(lo), "ci_high": float(hi), "p": float(p)}


def holm_adjust(results: list[dict], alpha: float = 0.05) -> None:
    reject, adjusted, _, _ = multipletests([r["p"] for r in results], alpha=alpha, method="holm")
    for result, p, decision in zip(results, adjusted, reject, strict=True):
        result.update(p_adjusted=float(p), significant=bool(decision))


def analyze_ab(rows: pd.DataFrame, *, draws: int = 2000, seed: int = 42) -> dict:
    data = select_design(rows, "ab")
    if (data.period < 0).any():
        raise ValueError("A/B rows must be post-change independent orders (period >=0)")
    control, treatment = [data.loc[data.arm == arm] for arm in (0, 1)]
    if min(len(control), len(treatment)) < 30:
        raise ValueError("A/B needs >=30 independent orders per arm")
    n = [len(control), len(treatment)]
    if control["items"].nunique() == treatment["items"].nunique() == 1:
        complexity_p = float(control["items"].iloc[0] == treatment["items"].iloc[0])
    else:
        complexity_p = float(
            stats.ttest_ind(control["items"], treatment["items"], equal_var=False).pvalue
        )
    location_table = pd.crosstab(data.location, data.arm)
    expected = stats.contingency.expected_freq(location_table)
    if (expected < 5).any():
        raise ValueError("Location balance check needs >=5 expected observations in every cell")
    checks = [
        {"name": "50:50 sample ratio", "p": float(stats.binomtest(n[1], sum(n), 0.5).pvalue)},
        {"name": "pre-assignment item count", "p": complexity_p},
        {"name": "location balance", "p": float(stats.chi2_contingency(location_table)[1])},
    ]
    holm_adjust(checks, alpha=0.01)
    estimates = []
    for index, metric in enumerate(METRICS):
        a, b = control[metric].to_numpy(), treatment[metric].to_numpy()
        binary = metric != "service_seconds"
        result = bootstrap_difference(a, b, binary=binary, draws=draws, seed=seed + index)
        if binary:
            counts = np.array([a.sum(), b.sum()])
            if min(*counts, *(np.array(n) - counts)) < 5:
                raise ValueError(
                    f"{metric}: two-proportion z-test needs >=5 successes/failures per arm"
                )
            _, p = proportions_ztest(counts, n)
            result["bootstrap_p"] = result["p"]
            result["p"] = float(p)
        result.update(
            metric=metric,
            control=float(a.mean()),
            treatment=float(b.mean()),
            test="two-proportion z" if binary else "centered bootstrap",
        )
        estimates.append(result)
    holm_adjust(estimates)
    planned = plan_sample_size()
    return {
        "n_control": n[0],
        "n_treatment": n[1],
        "randomization": checks,
        "randomization_flag": any(c["significant"] for c in checks),
        "power_plan": {
            "baseline_accuracy": 0.90,
            "detectable_improvement": 0.03,
            "target_power": 0.80,
            "per_endpoint_alpha": 0.05 / 3,
            "required_per_arm": planned,
            "sample_target_met": min(n) >= planned,
        },
        "draws": draws,
        "metrics": estimates,
    }
