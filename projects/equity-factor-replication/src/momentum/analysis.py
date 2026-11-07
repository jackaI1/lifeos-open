"""Portfolio formation, explicit trading-cost scenarios and mean inference."""

import numpy as np
import pandas as pd
from math import erfc, sqrt
from statistics import NormalDist


def stock_spread(frame: pd.DataFrame) -> pd.Series:
    legs = frame[['Lo PRIOR', 'Hi PRIOR']]
    if not np.isfinite(legs.to_numpy()).all():
        raise ValueError('missing stock portfolio return')
    return legs['Hi PRIOR'] - legs['Lo PRIOR']


def industry_momentum(frame: pd.DataFrame, window: int, n: int = 5) -> pd.Series:
    """Use t-window-1 through t-2, then hold the selected legs in month t."""
    if window < 1 or n < 1:
        raise ValueError('window and portfolio size must be positive')
    signal = (1 + frame).rolling(window, min_periods=window).apply(np.prod, raw=True).shift(2)
    returns, dates = [], []
    for date, scores in signal.iterrows():
        eligible = scores.dropna().sort_values(kind='stable')
        if len(eligible) < 2*n:
            continue  # Warmup or insufficient historically available industries.
        low, high = eligible.index[:n], eligible.index[-n:]
        held = frame.loc[date, list(low) + list(high)]
        if not np.isfinite(held.to_numpy()).all():
            raise ValueError(f'missing selected industry return at {date}')
        returns.append(float(frame.loc[date, high].mean() - frame.loc[date, low].mean()))
        dates.append(date)
    return pd.Series(returns, index=pd.PeriodIndex(dates, freq='M', name='month'), dtype=float)


def apply_cost(returns: pd.Series, bps: float) -> pd.Series:
    if not np.isfinite(bps) or bps < 0:
        raise ValueError('cost must be finite and non-negative')
    return returns - 4*bps/10_000


def holm(pvalues: list[float]) -> list[float]:
    p = np.asarray(pvalues, dtype=float)
    if not np.isfinite(p).all() or ((p < 0) | (p > 1)).any():
        raise ValueError('invalid p-value')
    order = np.argsort(p, kind='stable')
    adjusted = np.empty(len(p))
    adjusted[order] = np.minimum(1, np.maximum.accumulate(p[order] * np.arange(len(p), 0, -1)))
    return adjusted.tolist()


def summarize(returns: pd.Series, lags: int = 6) -> dict:
    x = np.asarray(returns, dtype=float)
    n = len(x)
    if n < 3 or not np.isfinite(x).all() or lags < 0:
        raise ValueError('at least three finite observations and non-negative lags required')
    mean = float(x.mean())
    residuals = x - mean
    sd = float(x.std(ddof=1))
    if sd < 1e-14:
        raise ValueError('degenerate constant return series')
    long_variance = np.dot(residuals, residuals) / n
    lag_count = min(lags, n-1)
    for lag in range(1, lag_count + 1):
        gamma = np.dot(residuals[lag:], residuals[:-lag]) / n
        long_variance += 2 * (1 - lag/(lag_count+1)) * gamma
    se = float(np.sqrt(max(0, long_variance) / n))
    if se <= 0:
        raise ValueError('degenerate HAC variance')
    return {'n': n, 'mean_monthly': mean, 'annual_mean': 12*mean,
            'annual_volatility': np.sqrt(12)*sd, 'sharpe': np.sqrt(12)*mean/sd,
            'hac_se_monthly': se, 'p_raw': erfc(mean/se/sqrt(2))/2,
            'ci_low': 12*(mean-NormalDist().inv_cdf(0.975)*se),
            'ci_high': 12*(mean+NormalDist().inv_cdf(0.975)*se),
            'break_even_bps': mean*10_000/4}
