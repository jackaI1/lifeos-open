import numpy as np
import pytest
from statsmodels.stats.power import NormalIndPower
from statsmodels.stats.proportion import proportion_effectsize

from experiment_analysis import Simulation, analyze_ab, plan_sample_size, simulate
from experiment_analysis.ab import bootstrap_difference, holm_adjust


def test_recovers_planted_ab_effects(orders):
    result = analyze_ab(orders)
    truth = {"correct": (0.035, 0.015), "automated": (0.10, 0.025), "service_seconds": (-18, 1.0)}
    for metric in result["metrics"]:
        expected, tolerance = truth[metric["metric"]]
        assert metric["effect"] == pytest.approx(expected, abs=tolerance)
        assert metric["ci_low"] < expected < metric["ci_high"]
        assert metric["significant"]
        assert metric["p_adjusted"] >= metric["p"]
    assert not result["randomization_flag"]
    assert result["power_plan"]["sample_target_met"]


def test_sample_plan_actually_reaches_target_power():
    required = plan_sample_size()
    effect = abs(proportion_effectsize(0.93, 0.90))
    model = NormalIndPower()
    assert model.power(effect, nobs1=required, alpha=0.05 / 3) >= 0.80
    assert model.power(effect, nobs1=required - 1, alpha=0.05 / 3) < 0.80
    assert plan_sample_size(improvement=0.01) > required


@pytest.mark.parametrize("kwargs", [{"baseline": 1}, {"improvement": -0.01}, {"power": 0}])
def test_rejects_invalid_power_plan(kwargs):
    with pytest.raises(ValueError):
        plan_sample_size(**kwargs)


def test_holm_controls_the_endpoint_family():
    results = [{"p": p} for p in [0.01, 0.03, 0.04]]
    holm_adjust(results)
    assert [r["p_adjusted"] for r in results] == pytest.approx([0.03, 0.06, 0.06])
    assert [r["significant"] for r in results] == [True, False, False]


def test_unequal_assignment_is_flagged(orders):
    subset = orders.loc[
        (orders.experiment == "ab") & ((orders.arm == 0) | (orders.order_id % 4 == 0))
    ]
    result = analyze_ab(subset, draws=999)
    assert result["randomization_flag"]
    assert result["randomization"][0]["significant"]


def test_balanced_counts_do_not_hide_covariate_imbalance(orders):
    corrupted = orders.loc[orders.experiment == "ab"].copy()
    corrupted["items"] += corrupted.arm * 10
    result = analyze_ab(corrupted, draws=999)
    assert result["randomization_flag"]
    assert result["randomization"][1]["significant"]


def test_null_ab_is_not_a_winner():
    rows, _ = simulate(
        Simulation(seed=10, accuracy_effect=0, automation_effect=0, service_effect=0)
    )
    result = analyze_ab(rows, draws=999)
    assert not any(m["significant"] for m in result["metrics"])


def test_bootstrap_null_is_centered_and_reproducible():
    rng = np.random.default_rng(20)
    a = rng.normal(100, 12, 600)
    b = rng.normal(110, 12, 600)
    first = bootstrap_difference(a, b, draws=999)
    assert first == bootstrap_difference(a, b, draws=999)
    assert first["ci_low"] < 10 < first["ci_high"]
    assert first["p"] < 0.01
    identical = bootstrap_difference(a, a, draws=999)
    assert identical["p"] == 1
    assert identical["ci_low"] < 0 < identical["ci_high"]


def test_sparse_binary_outcomes_are_rejected(orders):
    rows = orders.copy()
    rows["correct"] = 1
    with pytest.raises(ValueError, match="successes/failures"):
        analyze_ab(rows, draws=999)
