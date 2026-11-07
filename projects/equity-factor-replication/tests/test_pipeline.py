import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from momentum.pipeline import build, main, require_period

ROOT = Path(__file__).resolve().parents[1]


def test_missing_period_month_cannot_silently_shorten_sample():
    series = pd.Series([0.01, 0.02], index=pd.PeriodIndex(['2000-01', '2000-03'], freq='M'))
    with pytest.raises(ValueError, match='coverage'):
        require_period(series, '2000-01', '2000-03')


def test_offline_public_snapshot_pipeline_and_deterministic_outputs(tmp_path):
    first, second = tmp_path/'first', tmp_path/'second'
    build(ROOT/'data', first)
    build(ROOT/'data', second)
    results = pd.read_csv(first/'results.csv')
    assert len(results) == 120
    assert set(results.loc[results.period == 'in_sample', 'n']) == {300}
    assert set(results.loc[results.period == 'out_of_sample', 'n']) == {432}
    assert (results.p_holm >= results.p_raw).all()
    assert results.groupby(['strategy', 'period']).size().eq(4).all()
    baseline = results[(results.strategy == 'stock_vw') & (results.period == 'out_of_sample')]
    gross = baseline.loc[baseline.cost_bps == 0, 'annual_mean'].item()
    costly = baseline.loc[baseline.cost_bps == 50, 'annual_mean'].item()
    assert gross - costly == pytest.approx(0.24)
    monthly = pd.read_csv(first/'monthly_returns.csv')
    assert len(monthly) == 732
    assert monthly.month.iloc[0] == '1965-01'
    assert monthly.month.iloc[-1] == '2025-12'
    assert np.isfinite(monthly.iloc[:, 1:]).all().all()
    assert len(json.loads((first/'results.json').read_text())['tests']) == 120
    for name in ['report.md', 'results.csv', 'results.json', 'monthly_returns.csv',
                 'cumulative.png', 'costs.png', 'formation.png']:
        assert (first/name).read_bytes() == (second/name).read_bytes()
    assert main(['--data-dir', str(ROOT/'data'), '--output', str(first), '--check']) == 0
    (first/'report.md').write_text('stale')
    assert main(['--data-dir', str(ROOT/'data'), '--output', str(first), '--check']) == 1
