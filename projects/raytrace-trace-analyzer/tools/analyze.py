"""Validate renderer traces, compare matching workloads, and write a frame report."""
import argparse
import json
import math
import statistics
from pathlib import Path

TIMINGS = ('build_ms', 'render_ms', 'encode_ms', 'total_ms')
COUNTS = ('primary_rays', 'shadow_rays', 'primitive_tests', 'box_tests')


def number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def validate(data):
    if not isinstance(data, dict) or type(data.get('schema_version')) is not int or data['schema_version'] != 1:
        raise ValueError('expected schema_version 1')
    if not isinstance(data.get('scene'), str) or not data['scene']:
        raise ValueError('scene must identify the rendered workload')
    for key in ('width', 'height'):
        if type(data.get(key)) is not int or data[key] <= 0:
            raise ValueError(f'{key} must be a positive integer')
    frames = data.get('frames')
    if not isinstance(frames, list) or not frames:
        raise ValueError('trace must contain frames')
    seen = set()
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError('frame must be an object')
        fid = frame.get('frame')
        if type(fid) is not int or fid < 0 or fid in seen:
            raise ValueError('frame IDs must be unique nonnegative integers')
        seen.add(fid)
        for key in TIMINGS + COUNTS:
            value = frame.get(key)
            if not number(value) or (key in COUNTS and type(value) is not int):
                raise ValueError(f'frame {fid}: invalid {key}')
        if frame['primary_rays'] != data['width'] * data['height']:
            raise ValueError(f'frame {fid}: primary ray count disagrees with dimensions')
    return data


def load_trace(path):
    return validate(json.loads(Path(path).read_text()))


def compare(current, baseline=None, *, budget_ms=16.67, regression_pct=10, min_delta_ms=1):
    validate(current)
    if not all(number(x) for x in (budget_ms, regression_pct, min_delta_ms)):
        raise ValueError('thresholds must be finite and nonnegative')
    frames = sorted(current['frames'], key=lambda f: f['frame'])
    old = {}
    if baseline is not None:
        validate(baseline)
        if any(current[key] != baseline[key] for key in ('scene', 'width', 'height')):
            raise ValueError('cannot compare different scenes or image dimensions')
        old = {f['frame']: f for f in baseline['frames']}
        if set(old) != {f['frame'] for f in frames}:
            raise ValueError('frame IDs must match between runs')
    regressions = []
    for f in frames:
        if f['frame'] in old:
            before = old[f['frame']]['render_ms']
            delta = f['render_ms'] - before
            percent = 100 * delta / before if before else None
            if delta > min_delta_ms and (percent is None or percent > regression_pct):
                regressions.append({'frame': f['frame'], 'delta_ms': delta, 'percent': percent})
    values = sorted(f['render_ms'] for f in frames)
    return {'slow_frames': [f['frame'] for f in frames if f['render_ms'] > budget_ms],
            'regressions': regressions,
            'summary': {'frames': len(frames), 'median_ms': statistics.median(values),
                        'p95_ms': values[math.ceil(.95 * len(values))-1], 'max_ms': max(values)}}


def write_report(current, baseline, output, **thresholds):
    result = compare(current, baseline, **thresholds)
    # Headless plotting, with figure lifetime scoped to this report.
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    output = Path(output)
    if output.suffix != '.md':
        raise ValueError('report output must have a .md extension')
    output.parent.mkdir(parents=True, exist_ok=True)
    plot = output.with_suffix('.svg')
    fig, ax = plt.subplots(figsize=(9, 4))
    try:
        for label, run in [('Current', current), ('Baseline', baseline)]:
            if run:
                frames = sorted(run['frames'], key=lambda f: f['frame'])
                ax.plot([f['frame'] for f in frames], [f['render_ms'] for f in frames], marker='o', label=label)
        ax.axhline(thresholds.get('budget_ms', 16.67), color='firebrick', linestyle='--', label='Frame budget')
        ax.set(xlabel='Frame ID', ylabel='Render time (ms)', title='Matching frames across runs')
        ax.legend(); fig.tight_layout(); fig.savefig(plot)
    finally:
        plt.close(fig)
    s = result['summary']
    lines = ['# Frame timing report', '',
             f"{s['frames']} frames. Median {s['median_ms']:.3f} ms; p95 {s['p95_ms']:.3f} ms; maximum {s['max_ms']:.3f} ms.", '',
             f"Slow frames (render time > {thresholds.get('budget_ms',16.67):g} ms): " + (', '.join(map(str,result['slow_frames'])) or 'none') + '.', '',
             f"Regression rule: increase > {thresholds.get('regression_pct',10):g}% AND > {thresholds.get('min_delta_ms',1):g} ms.", '',
             f'![Frame render timings]({plot.name})', '', '## Regressions', '']
    if baseline is None:
        lines += ['No baseline supplied.']
    elif not result['regressions']:
        lines += ['No matching frames exceeded both regression thresholds.']
    for r in result['regressions']:
        pct = f"{r['percent']:.1f}%" if r['percent'] is not None else 'zero baseline'
        lines += [f"- Frame {r['frame']}: +{r['delta_ms']:.3f} ms ({pct})."]
    lines += ['', '## Frame details', '',
              '| Frame | Build ms | Render ms | PNG ms | Total ms | Primary rays | Shadow rays | Primitive tests | Box tests |',
              '| --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for f in sorted(current['frames'], key=lambda f: f['frame']):
        lines += [f"| {f['frame']} | " + ' | '.join(f'{f[k]:.3f}' for k in TIMINGS) + ' | ' + ' | '.join(str(f[k]) for k in COUNTS) + ' |']
    lines += ['', 'Only render_ms drives alerts. Build and PNG encoding are reported separately.',
              'p95 uses the nearest rank. Timings depend on hardware and background load; use repeated Release runs.', '']
    output.write_text('\n'.join(lines))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('current', type=Path)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path, default=Path('report.md'))
    parser.add_argument('--budget-ms', type=float, default=16.67)
    parser.add_argument('--regression-pct', type=float, default=10)
    parser.add_argument('--min-delta-ms', type=float, default=1)
    args = parser.parse_args()
    try:
        inputs = {p.resolve() for p in (args.current, args.baseline) if p is not None}
        outputs = (args.output, args.output.with_suffix('.svg'))
        if any(out.resolve() in inputs or (out.exists() and any(out.samefile(p) for p in inputs))
               for out in outputs):
            raise ValueError('report and plot must not overwrite input traces')
        result = write_report(load_trace(args.current), load_trace(args.baseline) if args.baseline else None,
                              args.output, budget_ms=args.budget_ms, regression_pct=args.regression_pct,
                              min_delta_ms=args.min_delta_ms)
    except (ValueError, OSError) as exc:
        parser.exit(2, f'error: {exc}\n')
    print(json.dumps(result, indent=2, allow_nan=False))
    return int(bool(result['slow_frames'] or result['regressions']))


if __name__ == '__main__':
    raise SystemExit(main())
