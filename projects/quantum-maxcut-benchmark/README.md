# quantum-maxcut-benchmark

I built a graph-cutting benchmark to learn how the underlying idea works. This is a learning project.

## Try it

You need Python 3.10 or newer. From the project directory:

```sh
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[test]'
pytest -q
maxcut-benchmark --sizes 6 8 --seeds 1 2 --depths 1 2 --maxiter 12 --shots 512 --output my-results
```

The command writes a CSV of individual runs, a settings file, and a comparison plot. Omit the options to reproduce the full published experiment. Larger networks and deeper circuits require much more time and memory. The existing results are in [results](results/).

## How it works

Each graph is generated from its size, edge probability and seed, so the same inputs produce the same graph. The exact solver checks every possible split, using the fact that swapping both groups gives the same cut. The classical solver starts from 20 seeded random splits and repeatedly moves a point when that improves the cut.

QAOA alternates a circuit that encodes the cut with one that mixes possible assignments. Its depth `p` is the number of repetitions. COBYLA, a classical optimizer, adjusts the angles to improve the expected cut. Both Qiskit and PennyLane calculate expectations from simulated statevectors, which represent all possible outcomes. Qiskit also samples finite shots, or circuit measurements, with and without a 1% two-qubit depolarizing error after each compiled CX gate. The noisy and clean samples use angles optimized without noise; this isolates the effect of noise rather than re-optimizing for it.

The approximation ratio is the achieved cut divided by the exact optimum. Quantum expectation ratios describe the average measurement, while the CSV also records the best observed sampled cut. These are different measures and should not be confused. Runtime is wall-clock time on the machine that ran the experiment; it includes optimizer work for statevector runs and circuit compilation and execution for shot runs, so it is not a hardware speed comparison. The evaluation count records objective calls for optimization, and one circuit execution for each sampling run.

## Tests and limits

There are 1 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Generated output omitted from this copy: results/ (generated output). Regenerate it with the project scripts.

Retained project workflows: `quantum-maxcut-benchmark-ci.yml`. Their commands use this folder and their triggers use its paths.
