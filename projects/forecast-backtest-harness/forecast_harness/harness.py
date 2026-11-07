"""Leakage-safe hourly production forecasts with calibrated prediction intervals."""
from dataclasses import dataclass
import math

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error


@dataclass(frozen=True)
class Config:
    train_hours: int = 24 * 28
    calibration_hours: int = 24 * 7
    test_hours: int = 24 * 7
    folds: int = 3
    coverage: float = 0.90
    min_history: int = 168


def validate_data(data):
    """Return a sorted copy of a complete, unique, nonnegative hourly series."""
    if not isinstance(data, pd.DataFrame) or not {'timestamp', 'production'}.issubset(data.columns):
        raise ValueError('expected timestamp and production columns')
    df = data[['timestamp', 'production']].copy()
    df['timestamp'] = pd.to_datetime(df['timestamp'], errors='raise')
    df['production'] = pd.to_numeric(df['production'], errors='raise')
    if df.empty or df.isna().any().any() or not np.isfinite(df['production']).all():
        raise ValueError('timestamps and production must be finite and nonmissing')
    if (df['production'] < 0).any() or df['timestamp'].duplicated().any():
        raise ValueError('production must be nonnegative and timestamps unique')
    df = df.sort_values('timestamp').reset_index(drop=True)
    if len(df) > 1 and not (df['timestamp'].diff().iloc[1:] == pd.Timedelta(hours=1)).all():
        raise ValueError('timestamps must be consecutive hourly observations')
    return df


def synthetic_data(days=90, seed=42):
    """Make repeatable shift, weekday and trend patterns without external data."""
    rng = np.random.default_rng(seed)
    times = pd.date_range('2024-01-01', periods=days * 24, freq='h')
    hour = times.hour.to_numpy()
    shift = np.select([hour < 6, hour < 14, hour < 22], [42, 100, 78], default=42)
    weekday = np.where(times.dayofweek.to_numpy() < 5, 1.0, 0.76)
    production = shift * weekday + np.arange(len(times)) * 0.004 + rng.normal(0, 4, len(times))
    return pd.DataFrame({'timestamp': times, 'production': np.maximum(production, 0)})


def features(data):
    """Features at time t use only observations strictly before t."""
    y = data['production']
    t = data['timestamp'].dt
    result = pd.DataFrame({'hour': t.hour, 'weekday': t.dayofweek,
                           'lag_1': y.shift(1), 'lag_24': y.shift(24),
                           'lag_168': y.shift(168),
                           'mean_24': y.shift(1).rolling(24).mean(),
                           'mean_168': y.shift(1).rolling(168).mean()})
    return result


def backtest(data, config=Config()):
    """Evaluate one-hour-ahead forecasts; actuals arrive before the next hour.

    Each fold fits on train_hours, calibrates on the following calibration_hours,
    then tests on test_hours. Calibration and test never influence model fitting.
    """
    df = validate_data(data)
    c = config
    if min(c.train_hours, c.calibration_hours, c.test_hours, c.folds) <= 0 or not 0 < c.coverage < 1 or c.min_history < 168:
        raise ValueError('invalid backtest configuration')
    x = features(df)
    first_test = c.min_history + c.train_hours + c.calibration_hours
    if first_test + c.folds * c.test_hours > len(df):
        raise ValueError('not enough hourly observations for requested folds')
    rows = []
    predictions = []
    for fold in range(c.folds):
        test_start = first_test + fold * c.test_hours
        cal_start = test_start - c.calibration_hours
        train_start = cal_start - c.train_hours
        train = slice(train_start, cal_start)
        cal = slice(cal_start, test_start)
        test = slice(test_start, test_start + c.test_hours)
        y = df.production
        models = []
        for q in ((1 - c.coverage) / 2, 0.5, (1 + c.coverage) / 2):
            model = HistGradientBoostingRegressor(loss='quantile', quantile=q, max_iter=100,
                                                   max_leaf_nodes=15, learning_rate=0.08,
                                                   l2_regularization=1.0, random_state=42)
            model.fit(x.iloc[train], y.iloc[train])
            models.append(model)
        cal_predictions = np.column_stack([m.predict(x.iloc[cal]) for m in models])
        # Sort quantiles to prevent crossing; conformal score expands intervals only.
        cal_bounds = np.sort(cal_predictions[:, [0, 2]], axis=1)
        scores = np.maximum(cal_bounds[:, 0] - y.iloc[cal].to_numpy(), y.iloc[cal].to_numpy() - cal_bounds[:, 1])
        rank = math.ceil((len(scores) + 1) * c.coverage)
        # An unattainable finite-sample rank requires an infinite interval.
        correction = max(0.0, np.sort(scores)[rank - 1]) if rank <= len(scores) else float('inf')
        raw = np.column_stack([m.predict(x.iloc[test]) for m in models])
        bounds = np.sort(raw[:, [0, 2]], axis=1)
        low, high = bounds[:, 0] - correction, bounds[:, 1] + correction
        actual = y.iloc[test].to_numpy()
        naive = x.iloc[test]['lag_1'].to_numpy()
        seasonal = x.iloc[test]['lag_168'].to_numpy()
        # Extrapolate the average hourly change over the previous day.
        trend = np.maximum(0, naive + (naive - x.iloc[test]['lag_24'].to_numpy()) / 23)
        estimates = {'model': raw[:, 1], 'naive': naive, 'seasonal': seasonal, 'trend': trend}
        errors = {name: float(mean_absolute_error(actual, pred)) for name, pred in estimates.items()}
        best = min(errors[k] for k in ('naive', 'seasonal', 'trend'))
        rows.append({'fold': fold + 1, 'train_start': df.timestamp.iloc[train_start],
                     'train_end': df.timestamp.iloc[cal_start - 1], 'calibration_end': df.timestamp.iloc[test_start - 1],
                     'test_start': df.timestamp.iloc[test_start], 'test_end': df.timestamp.iloc[test_start + c.test_hours - 1],
                     **{name + '_mae': value for name, value in errors.items()},
                     'coverage': float(np.mean((actual >= low) & (actual <= high))),
                     'mean_interval_width': float(np.mean(high - low)),
                     'beats_best_baseline': errors['model'] < best})
        predictions.append(pd.DataFrame({'fold': fold + 1, 'timestamp': df.timestamp.iloc[test].to_numpy(),
                                         'actual': actual, 'prediction': raw[:, 1], 'lower': low, 'upper': high,
                                         'naive': naive, 'seasonal': seasonal, 'trend': trend}))
    report = pd.DataFrame(rows)
    return report, pd.concat(predictions, ignore_index=True), bool(report.beats_best_baseline.all())
