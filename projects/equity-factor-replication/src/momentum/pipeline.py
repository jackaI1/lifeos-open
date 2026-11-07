"""One-command, offline-first research pipeline."""

import argparse
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd

from .analysis import apply_cost, holm, industry_momentum, stock_spread, summarize
from .data import load_snapshot, parse_section
from .report import write_report

PERIODS = {
    'in_sample': ('1965-01', '1989-12'),
    'out_of_sample': ('1990-01', '2025-12'),
    'full': ('1965-01', '2025-12'),
    'early_test': ('1990-01', '2007-12'),
    'crisis': ('2008-01', '2009-12'),
    'late_test': ('2010-01', '2025-12'),
}
COSTS = (0, 10, 25, 50)


def require_period(series: pd.Series, start: str, end: str) -> pd.Series:
    selected = series.loc[start:end]
    expected = pd.period_range(start, end, freq='M', name='month')
    if not selected.index.equals(expected) or not np.isfinite(selected.to_numpy()).all():
        raise ValueError(f'incomplete coverage: {start} through {end}')
    return selected


def build(data_dir: Path, output: Path, download: bool = False) -> None:
    manifest = json.loads((data_dir/'manifest.json').read_text())
    raw = {record['file']: load_snapshot(data_dir/'raw', record, download) for record in manifest}
    stock_raw = raw['10_Portfolios_Prior_12_2_CSV.zip']
    portfolios = {}
    for name, section in [('stock_vw', 'Value Weight Returns -- Monthly'),
                          ('stock_ew', 'Average Equal Weighted Returns -- Monthly')]:
        frame = parse_section(stock_raw, section, 10).loc['1965-01':'2025-12']
        portfolios[name] = stock_spread(frame)
    industries = parse_section(raw['49_Industry_Portfolios_CSV.zip'],
                               'Average Value Weighted Returns -- Monthly', 49)
    # Historical warmup is retained; only complete research years enter the results.
    industries = industries.loc['1963-12':'2025-12']
    for window in (3, 6, 12):
        portfolios[f'industry_{window}m'] = industry_momentum(industries, window)
    monthly = pd.DataFrame({name: require_period(series, *PERIODS['full'])
                            for name, series in portfolios.items()})
    records = []
    for name in portfolios:
        for period, (start, end) in PERIODS.items():
            gross = require_period(monthly[name], start, end)
            for bps in COSTS:
                stats = summarize(apply_cost(gross, bps))
                # Break-even cost is always based on the gross spread, not already net returns.
                stats['break_even_bps'] = float(gross.mean()*10_000/4)
                records.append({'strategy': name, 'period': period, 'start': start, 'end': end,
                                'cost_bps': bps, **stats})
    corrected = holm([record['p_raw'] for record in records])
    for record, p_adjusted in zip(records, corrected, strict=True):
        record['p_holm'] = p_adjusted
        record['reject_holm_5pct'] = bool(p_adjusted < 0.05)
    output.mkdir(parents=True, exist_ok=True)
    # Stable significant digits preserve small p-values while suppressing platform roundoff.
    stable = [{k: float(f'{v:.10g}') if isinstance(v, (float, np.floating)) else v
               for k, v in record.items()} for record in records]
    table = pd.DataFrame(stable)
    table.to_csv(output/'results.csv', index=False, float_format='%.10g')
    monthly.to_csv(output/'monthly_returns.csv', index_label='month', float_format='%.10g')
    payload = {'protocol': 'docs/protocol.md', 'family_size': len(stable),
               'sources': manifest, 'tests': stable}
    (output/'results.json').write_text(json.dumps(payload, indent=2, allow_nan=False)+'\n')
    write_report(table, monthly, output)
    print(f'Generated {len(table)} tests and {len(monthly)} monthly observations in {output}')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, default=Path('data'))
    parser.add_argument('--output', type=Path, default=Path('reports'))
    parser.add_argument('--download', action='store_true', help='fetch and verify frozen source bytes')
    parser.add_argument('--check', action='store_true', help='check committed report and numeric artifacts')
    args = parser.parse_args(argv)
    try:
        if args.check:
            with TemporaryDirectory(prefix='momentum-check-') as scratch:
                generated = Path(scratch)
                build(args.data_dir, generated, args.download)
                for name in ['results.csv', 'monthly_returns.csv', 'results.json', 'report.md']:
                    if (generated/name).read_bytes() != (args.output/name).read_bytes():
                        print(f'Stale artifact: {name}; run uv run momentum')
                        return 1
            print('Report and numeric artifacts reproduce. PNG rendering may vary by platform.')
        else:
            build(args.data_dir, args.output, args.download)
    except (ValueError, OSError) as error:
        print(f'Research run failed: {error}')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
