import numpy as np
import pandas as pd
import pytest
from forecast_harness.harness import Config, backtest, features, synthetic_data, validate_data


@pytest.fixture(scope='module')
def result():
    return backtest(synthetic_data())


def test_validation():
    data = synthetic_data(2)
    assert len(validate_data(data.sample(frac=1))) == 48
    for bad in [pd.concat([data, data.iloc[:1]]), data.drop(index=4), data.assign(production=-1), data.assign(production=np.nan)]:
        with pytest.raises(ValueError):
            validate_data(bad)
    with pytest.raises(ValueError):
        backtest(data)


def test_features_do_not_use_current_or_future_values():
    data = synthetic_data(10)
    original = features(data)
    changed = data.copy()
    changed.loc[200:, 'production'] += 10000
    pd.testing.assert_frame_equal(original.iloc[:201], features(changed).iloc[:201])


def test_future_changes_cannot_change_first_fold_predictions(result):
    data = synthetic_data()
    report, predictions, _ = result
    cutoff = report.loc[0, 'test_start']
    changed = data.copy()
    changed.loc[changed.timestamp >= cutoff, 'production'] += 10000
    _, altered, _ = backtest(changed)
    # The first prediction uses only the history available before the test starts.
    cols = ['prediction', 'lower', 'upper', 'naive', 'seasonal', 'trend']
    np.testing.assert_allclose(predictions.loc[0, cols].astype(float), altered.loc[0, cols].astype(float))


def test_report_and_acceptance(result):
    report, predictions, accepted = result
    assert len(report) == 3 and len(predictions) == 3 * 168
    assert ((predictions.lower <= predictions.upper)).all()
    assert report.coverage.between(0, 1).all()
    assert accepted == bool((report.model_mae < report[['naive_mae', 'seasonal_mae', 'trend_mae']].min(axis=1)).all())
    assert (report.train_end < report.calibration_end).all()
    assert (report.calibration_end < report.test_start).all()
