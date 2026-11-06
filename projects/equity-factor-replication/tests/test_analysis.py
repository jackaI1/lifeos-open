import numpy as np
import pandas as pd
import pytest

from momentum.analysis import apply_cost, holm, industry_momentum, stock_spread, summarize


def test_stock_spread_is_high_minus_low_and_rejects_missing():
    df = pd.DataFrame({'Lo PRIOR': [0.01, -0.02], 'Hi PRIOR': [0.04, 0.01]})
    np.testing.assert_allclose(stock_spread(df), [0.03, 0.03])
    df.iloc[0, 1] = np.nan
    with pytest.raises(ValueError, match='missing'):
        stock_spread(df)


def test_industry_ranking_compounds_and_skips_last_month():
    dates = pd.period_range('2000-01', periods=5, freq='M')
    # In month 5, use months 1-3: B wins on compounded return; month 4 is skipped.
    df = pd.DataFrame({'A': [0.5, -0.4, 0.2, 10, 0.03],
                       'B': [0.1, 0.1, 0.1, -0.9, 0.08],
                       'C': [-0.1, -0.1, -0.1, 0, -0.02]}, index=dates)
    result = industry_momentum(df, window=3, n=1)
    assert result.index[0] == dates[4]
    assert result.iloc[0] == pytest.approx(0.1)
    # Changing current or future returns cannot alter earlier rankings.
    df.loc[dates[3], 'A'] = -0.99
    assert industry_momentum(df, 3, n=1).iloc[0] == pytest.approx(0.1)


def test_future_changes_do_not_change_past_portfolios():
    rng = np.random.default_rng(41)
    df = pd.DataFrame(rng.normal(0, 0.1, (36, 10)),
                      index=pd.period_range('2000-01', periods=36, freq='M'))
    before = industry_momentum(df, 6, n=2)
    df.iloc[24:] += 0.5
    after = industry_momentum(df, 6, n=2)
    pd.testing.assert_series_equal(before.iloc[:17], after.iloc[:17])


def test_missing_history_is_ineligible_but_missing_held_return_fails():
    df = pd.DataFrame({'A': [0.1]*6, 'B': [-0.1]*6, 'C': [np.nan]*6},
                      index=pd.period_range('2000-01', periods=6, freq='M'))
    assert industry_momentum(df, 3, n=1).iloc[0] == pytest.approx(0.2)
    df.iloc[4, 0] = np.nan
    with pytest.raises(ValueError, match='selected'):
        industry_momentum(df, 3, n=1)


def test_costs_charge_both_legs_entry_and_exit():
    np.testing.assert_allclose(apply_cost(pd.Series([0.02, -0.01]), 25), [0.01, -0.02])
    with pytest.raises(ValueError):
        apply_cost(pd.Series([0.02]), -1)


def test_holm_hand_calculated_and_preserves_input_order():
    assert holm([0.04, 0.001, 0.03]) == pytest.approx([0.06, 0.003, 0.06])
    assert holm([0.9, 0.8]) == [1.0, 1.0]


def test_hac_matches_hand_calculation_with_bartlett_weight():
    # Residuals [-1.5,-0.5,0.5,1.5]/100; gamma0=.000125, gamma1=.00003125.
    # Lag 1 weight .5, var(mean)=(gamma0 + gamma1)/4.
    x = pd.Series([0.01, 0.02, 0.03, 0.04])
    result = summarize(x, lags=1)
    se = np.sqrt(0.00015625 / 4)
    assert result['mean_monthly'] == pytest.approx(0.025)
    assert result['hac_se_monthly'] == pytest.approx(se)
    assert result['p_raw'] == pytest.approx(3.167124183311986e-5)
    assert result['annual_mean'] == pytest.approx(0.3)
    assert result['ci_low'] == pytest.approx(0.15300270115949594)
    assert result['break_even_bps'] == pytest.approx(62.5)
    assert result['sharpe'] == pytest.approx(6.7082039325)


@pytest.mark.parametrize('values', [[0.1], [0.1, np.nan], [np.inf, 0.1], [0.1]*10])
def test_inference_rejects_invalid_or_degenerate_series(values):
    with pytest.raises(ValueError):
        summarize(pd.Series(values))
