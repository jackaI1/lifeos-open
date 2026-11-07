import csv
import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

from alm_model.model import ASSETS, ReturnModel, calibrate, load_history, optimize, psd_root

ROOT = Path(__file__).resolve().parents[1]


def diagonal_model(means=(0.10, 0.04), variances=(0.04, 0.01)):
    means = np.array(means)
    log_var = np.log1p(np.array(variances) / (1 + means) ** 2)
    return ReturnModel(("stocks", "bonds"), np.log1p(means) - log_var / 2, np.diag(log_var))


def test_snapshot_integrity_and_known_crisis_observation():
    path = ROOT / "data/annual_returns.csv"
    provenance = json.loads((ROOT / "data/provenance.json").read_text())
    assert hashlib.sha256(path.read_bytes()).hexdigest() == provenance["csv_sha256"]
    years, returns = load_history(path)
    assert years.tolist() == list(range(1976, 2026))
    assert returns.shape == (50, 4)
    # NYU source: stocks and Treasury bonds both lost money in 2022.
    assert returns[years == 2022, 0].item() == pytest.approx(-0.1804, abs=0.0001)
    assert returns[years == 2022, 1].item() == pytest.approx(-0.1783, abs=0.0001)
    assert returns[years == 2025, 0].item() == pytest.approx(0.17723658, abs=1e-8)


def test_calibration_matches_manual_sample_estimate():
    returns = np.array([[0.2, -0.1], [-0.2, 0.05], [0.1, 0.02]])
    model = calibrate(returns, ("a", "b"))
    logs = np.log1p(returns)
    expected_cov = (logs - logs.mean(0)).T @ (logs - logs.mean(0)) / 2
    np.testing.assert_allclose(model.log_mean, logs.mean(0))
    np.testing.assert_allclose(model.log_cov, expected_cov)


def test_lognormal_moments_match_arithmetic_inputs():
    model = diagonal_model()
    np.testing.assert_allclose(model.mean, [0.1, 0.04], atol=1e-14)
    np.testing.assert_allclose(model.cov, np.diag([0.04, 0.01]), atol=1e-14)


def test_optimizer_has_known_minimum_variance_solution():
    # For independent assets: w1 = variance2 / (variance1 + variance2).
    result = optimize(diagonal_model(), target_return=0, max_weight=1)
    np.testing.assert_allclose(result.weights, [0.2, 0.8], atol=1e-6)
    assert result.volatility**2 == pytest.approx(0.008, abs=1e-10)


def test_optimizer_binding_return_floor_and_cap():
    result = optimize(diagonal_model(), target_return=0.07, max_weight=0.65)
    np.testing.assert_allclose(result.weights, [0.5, 0.5], atol=1e-6)
    assert result.expected_return == pytest.approx(0.07, abs=1e-9)
    capped = optimize(diagonal_model(), target_return=0.04, max_weight=0.65)
    np.testing.assert_allclose(capped.weights, [0.35, 0.65], atol=1e-6)


@pytest.mark.parametrize(
    "target,cap", [(0.15, 1), (0.09, 0.65), (0.05, 0.4), (0, 0), (float("nan"), 1), (0, 1.1)]
)
def test_optimizer_rejects_invalid_or_infeasible_constraints(target, cap):
    with pytest.raises(ValueError):
        optimize(diagonal_model(), target, cap)


def test_optimizer_beats_feasible_grid_and_equal_weight_reference():
    _, returns = load_history(ROOT / "data/annual_returns.csv")
    model = calibrate(returns)
    target = float(model.mean.mean())
    result = optimize(model, target, 0.65)
    equal_variance = np.full(4, 0.25) @ model.cov @ np.full(4, 0.25)
    assert result.volatility**2 <= equal_variance + 1e-10
    for a in np.arange(0, 0.651, 0.1):
        for b in np.arange(0, 0.651, 0.1):
            for c in np.arange(0, 0.651, 0.1):
                w = np.array([a, b, c, 1 - a - b - c])
                if w.min() >= 0 and w.max() <= 0.65 and w @ model.mean >= target:
                    assert result.volatility**2 <= w @ model.cov @ w + 1e-9


@pytest.mark.parametrize("blend", [0, 0.35, 1])
def test_correlation_stress_preserves_marginals_and_psd(blend):
    _, returns = load_history(ROOT / "data/annual_returns.csv")
    original = calibrate(returns)
    stress = original.stress_correlations(blend)
    np.testing.assert_allclose(stress.mean, original.mean, atol=1e-14)
    np.testing.assert_allclose(np.diag(stress.cov), np.diag(original.cov), atol=1e-14)
    expected = (1 - blend) * original.correlation + blend * np.ones((4, 4))
    np.testing.assert_allclose(stress.correlation, expected, atol=1e-14)
    assert np.linalg.eigvalsh(stress.log_cov).min() >= -1e-12


def test_simulated_moments_and_cross_asset_dependence():
    model = ReturnModel(
        ("a", "b"), np.array([0.04, 0.02]), np.array([[0.04, 0.012], [0.012, 0.01]])
    )
    shocks = np.random.default_rng(12).standard_normal((100_000, 1, 2))
    samples = model.simulate(shocks)[:, 0]
    assert samples.min() > -1
    mean_error = 6 * np.sqrt(np.diag(model.cov) / len(samples))
    assert np.all(np.abs(samples.mean(0) - model.mean) < mean_error)
    np.testing.assert_allclose(np.cov(samples, rowvar=False), model.cov, rtol=0.035, atol=0.0001)
    np.testing.assert_allclose(
        np.cov(np.log1p(samples), rowvar=False), model.log_cov, rtol=0.025, atol=0.0001
    )
    np.testing.assert_array_equal(model.simulate(shocks), model.simulate(shocks))


def test_singular_and_zero_variance_simulation():
    model = ReturnModel(
        ("fixed", "a", "b"),
        np.array([0.02, 0.03, 0.04]),
        np.array([[0, 0, 0], [0, 0.01, 0.02], [0, 0.02, 0.04]]),
    )
    root = psd_root(model.log_cov)
    np.testing.assert_allclose(root @ root.T, model.log_cov, atol=1e-14)
    samples = model.simulate(np.random.default_rng(0).standard_normal((100, 1, 3)))
    np.testing.assert_allclose(samples[:, :, 0], np.expm1(0.02))
    assert np.isfinite(model.correlation).all()


@pytest.mark.parametrize(
    "cov", [[[1, 2], [2, 1]], [[1, 0], [1, 1]], [[1]], [[1, float("nan")], [float("nan"), 1]]]
)
def test_invalid_covariance_rejected(cov):
    with pytest.raises(ValueError):
        ReturnModel(("a", "b"), np.zeros(2), np.array(cov))


def test_model_owns_immutable_validated_arrays():
    means, cov = np.zeros(2), np.eye(2)
    model = ReturnModel(("a", "b"), means, cov)
    cov[0, 0] = -1
    means[0] = 100
    assert model.log_cov[0, 0] == 1
    assert model.log_mean[0] == 0
    with pytest.raises(ValueError):
        model.log_mean[0] = 42


@pytest.mark.parametrize(
    "years,values",
    [
        ([2000, 2002, 2003], [0, 0, 0]),
        ([2000, 2000, 2001], [0, 0, 0]),
        ([2000, 2001, 2002], [-1, 0, 0]),
        ([2000, 2001, 2002], [float("nan"), 0, 0]),
    ],
)
def test_history_rejects_bad_rows(tmp_path, years, values):
    path = tmp_path / "bad.csv"
    with path.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["year", *ASSETS])
        writer.writerows(
            [[year, *([value] * 4)] for year, value in zip(years, values, strict=True)]
        )
    with pytest.raises(ValueError):
        load_history(path)
