"""Reproducible examples and JSON reports, with an independent NumPy oracle."""

import argparse
from dataclasses import asdict
import json
from pathlib import Path

import numpy as np

from .analysis import analyze
from .model import Config, simulate
from .workloads import example_workloads


def checked_simulation(a, b, config, *, trace=False):
    result = simulate(a, b, config, trace=trace)
    expected = a.astype(np.int32) @ b.astype(np.int32)
    np.testing.assert_array_equal(result.output, expected)
    report = analyze((a.shape[0], a.shape[1], b.shape[1]), config)
    for key, value in asdict(result.stats).items():
        if report[key] != value:
            raise AssertionError(f"analytical {key} differs from clocked execution")
    report["numpy_checked"] = True
    return result, report


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Explore an int8 weight-stationary matrix accelerator"
    )
    commands = parser.add_subparsers(dest="command", required=True)
    demo = commands.add_parser(
        "demo", help="run a 2x2 example, optionally showing every clock"
    )
    demo.add_argument("--trace", action="store_true")
    sweep = commands.add_parser(
        "sweep", help="compare five layer shapes on several array sizes"
    )
    sweep.add_argument("--tiles", nargs="+", type=int, default=[4, 8, 16])
    sweep.add_argument("--json", action="store_true")
    sweep.add_argument(
        "--verify",
        action="store_true",
        help="execute each clocked model and check NumPy and analytical counts",
    )
    sweep.add_argument("--seed", type=int, default=7)
    matmul = commands.add_parser(
        "matmul", help="run int8 matrices a and b from a NumPy .npz archive"
    )
    matmul.add_argument("input", type=Path)
    matmul.add_argument("--output", type=Path, required=True)
    matmul.add_argument("--tile", type=int, default=8)
    for command in (demo, sweep, matmul):
        command.add_argument(
            "--bandwidth",
            type=float,
            default=16,
            help="aggregate external bytes per clock",
        )
        command.add_argument(
            "--tile-m",
            type=int,
            default=64,
            help="input rows streamed per resident weight panel",
        )
    args = parser.parse_args(argv)
    try:
        if args.command == "demo":
            a = np.array([[1, 2], [3, 4]], dtype=np.int8)
            b = np.array([[5, 6], [7, 8]], dtype=np.int8)
            result, report = checked_simulation(
                a, b, Config(2, 2, args.tile_m, args.bandwidth), trace=args.trace
            )
            print("A =", a.tolist(), " B =", b.tolist())
            print("C =", result.output.tolist())
            print("NumPy check: PASS")
            print(
                f"{report['cycles']} clocks; {100 * report['utilisation']:.1f}% total utilisation"
            )
            for event in result.trace:
                print(
                    f"clock {event.clock:2} {event.phase:6} MACs={len(event.macs)} outputs={event.outputs} weights={event.weights}"
                )
        elif args.command == "sweep":
            reports = []
            for tile in args.tiles:
                config = Config(tile, tile, args.tile_m, args.bandwidth)
                for case in example_workloads(args.seed):
                    shape = (case.a.shape[0], case.a.shape[1], case.b.shape[1])
                    if args.verify:
                        _, report = checked_simulation(case.a, case.b, config)
                    else:
                        report = analyze(shape, config)
                        report["numpy_checked"] = False
                    report.update(
                        layer=case.name, tile=tile, description=case.description
                    )
                    reports.append(report)
            if args.json:
                print(json.dumps(reports, indent=2, allow_nan=False))
            else:
                print(
                    "layer              tile   M,K,N           cycles  util%  stream%  DRAM-B  A-reuse W-reuse ops/B  achieved/roof ops/clk  energy-proxy"
                )
                for r in reports:
                    shape = ",".join(map(str, r["shape"]))
                    print(
                        f"{r['layer']:18} {r['tile']:4} {shape:15} {r['cycles']:7} {100 * r['utilisation']:6.1f} {100 * r['stream_utilisation']:7.1f} {r['dram_bytes']:7} {r['activation_reuse']:7.1f} {r['weight_reuse']:7.1f} {r['ops_per_byte']:5.1f} {r['achieved_ops_per_cycle']:8.2f}/{r['roofline_ops_per_cycle']:<8.2f} {r['energy_proxy']:12.0f}"
                    )
                print(
                    "NumPy checks: PASS"
                    if args.verify
                    else "Analytical estimates only; add --verify to execute every clock."
                )
                print(
                    "Energy proxy uses relative units, not joules. Assumptions: docs/architecture.md"
                )
        else:
            with np.load(args.input, allow_pickle=False) as archive:
                a, b = archive["a"], archive["b"]
            result, report = checked_simulation(
                a, b, Config(args.tile, args.tile, args.tile_m, args.bandwidth)
            )
            np.save(args.output, result.output, allow_pickle=False)
            print(json.dumps(report, indent=2, allow_nan=False))
    except (ValueError, TypeError, OSError, KeyError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
