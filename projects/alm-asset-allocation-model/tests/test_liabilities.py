import numpy as np
import pytest

from alm_model.liabilities import liability_stream, present_value, test_coverage


def test_growing_liabilities_and_end_year_discounting():
    payments = liability_stream(3, 100, 0.02)
    np.testing.assert_allclose(payments, [100, 102, 104.04])
    assert present_value(payments, 0.05) == pytest.approx(
        100 / 1.05 + 102 / 1.05**2 + 104.04 / 1.05**3
    )


def test_unpaid_obligations_and_absorbing_ruin():
    coverage = test_coverage(np.zeros((2, 4, 1)), [1], [40, 40, 40, 40], 100, 0.1)
    result = coverage.summary()
    assert result["shortfall_probability"] == 1
    assert result["expected_pv_unpaid"] == pytest.approx(20 / 1.1**3 + 40 / 1.1**4)
    assert result["mean_payment_coverage"] == 0.625
    assert result["mean_terminal_assets"] == 0
    assert [r["mean_assets_after_payment"] for r in coverage.yearly] == [60, 20, 0, 0]
    assert [r["shortfall_probability_to_date"] for r in coverage.yearly] == [0, 0, 1, 1]


def test_exact_funding_with_matching_deterministic_return():
    payments = liability_stream(20, 70_000, 0.02)
    initial_assets = present_value(payments, 0.04)
    coverage = test_coverage(np.full((3, 20, 1), 0.04), [1], payments, initial_assets, 0.04)
    assert coverage.summary()["shortfall_probability"] == 0
    assert coverage.summary()["mean_terminal_assets"] == pytest.approx(0, abs=1e-7)
    for year in coverage.yearly:
        assert year["mean_funded_ratio_before_payment"] == pytest.approx(1)


def test_returns_arrive_before_payment_and_annual_rebalancing():
    returns = np.array([[[1, 0], [0, 1]]])
    coverage = test_coverage(returns, [0.5, 0.5], [10, 10], 100, 0)
    assert coverage.summary()["mean_terminal_assets"] == 200
    failed = test_coverage(np.array([[[-0.5], [1.0]]]), [1], [60, 10], 100, 0)
    assert failed.summary()["expected_pv_unpaid"] == 20
    assert failed.summary()["mean_terminal_assets"] == 0


def test_coverage_monotonically_improves_with_more_initial_assets():
    returns = np.random.default_rng(2).uniform(-0.3, 0.3, (500, 10, 2))
    low = test_coverage(returns, [0.5, 0.5], np.full(10, 15), 100, 0.02)
    high = test_coverage(returns, [0.5, 0.5], np.full(10, 15), 150, 0.02)
    assert np.all(high.path_metrics["pv_unpaid"] <= low.path_metrics["pv_unpaid"] + 1e-10)
    assert np.all(high.path_metrics["shortfall"] <= low.path_metrics["shortfall"])


@pytest.mark.parametrize(
    "weights,payments,initial,discount",
    [
        ([0.2], [10], 100, 0),
        ([-1], [10], 100, 0),
        ([1], [-10], 100, 0),
        ([1], [0], 100, 0),
        ([1], [10], 0, 0),
        ([1], [10], 100, -1),
        ([1], [float("nan")], 100, 0),
        ([1], [10, 10], 100, 0),
    ],
)
def test_coverage_rejects_invalid_inputs(weights, payments, initial, discount):
    with pytest.raises(ValueError):
        test_coverage(np.zeros((2, 1, 1)), weights, payments, initial, discount)


@pytest.mark.parametrize(
    "years,payment,growth", [(0, 1, 0), (True, 1, 0), (2, -1, 0), (2, 1, -1), (2, 1, float("nan"))]
)
def test_liability_stream_rejects_invalid_inputs(years, payment, growth):
    with pytest.raises(ValueError):
        liability_stream(years, payment, growth)
