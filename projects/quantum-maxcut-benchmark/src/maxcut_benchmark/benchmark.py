"""Run a reproducible benchmark and save raw observations and plots."""
import argparse
import csv
import json
import time
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from .core import exact, graph, greedy
from .quantum import optimize, sample


def run(sizes, seeds, depths, iterations, shots, output):
    rows = []
    for n in sizes:
        for seed in seeds:
            g = graph(n, seed)
            start = time.perf_counter(); optimum, _ = exact(g); exact_time = time.perf_counter() - start
            start = time.perf_counter(); classical, _ = greedy(g, seed); classical_time = time.perf_counter() - start
            base = dict(n=n, seed=seed, edges=g.number_of_edges(), optimum=optimum)
            for name, value, elapsed in [('exact', optimum, exact_time), ('greedy', classical, classical_time)]:
                rows.append(dict(**base, method=name, p=0, maxiter=0, evaluations=0, seconds=elapsed, value=value, ratio=value/optimum if optimum else 1, best=value, shots=0, noise=0))
            for backend in ['qiskit', 'pennylane']:
                for p in depths:
                    start = time.perf_counter()
                    params, value, evaluations = optimize(g, backend, p, iterations, seed)
                    elapsed = time.perf_counter() - start
                    rows.append(dict(**base, method=backend, p=p, maxiter=iterations, evaluations=evaluations, seconds=elapsed, value=value, ratio=value/optimum if optimum else 1, best='', shots=0, noise=0))
                    if backend == 'qiskit':
                        for noise in [0.0, 0.01]:
                            start = time.perf_counter()
                            mean, best = sample(g, params, shots, seed, noise)
                            rows.append(dict(**base, method='qiskit_shots' if not noise else 'qiskit_noisy', p=p, maxiter=iterations, evaluations=1, seconds=time.perf_counter()-start, value=mean, ratio=mean/optimum if optimum else 1, best=best, shots=shots, noise=noise))
            print(f'n={n} seed={seed} complete', flush=True)
    output.mkdir(parents=True, exist_ok=True)
    with (output/'results.csv').open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys()); writer.writeheader(); writer.writerows(rows)
    (output/'settings.json').write_text(json.dumps(dict(sizes=sizes, seeds=seeds, depths=depths, maxiter=iterations, shots=shots, edge_probability=0.5, noise='two-qubit depolarizing error after each transpiled CX', noise_probability=0.01), indent=2)+'\n')
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for method in ['greedy', 'qiskit', 'pennylane', 'qiskit_shots', 'qiskit_noisy']:
        selected = [r for r in rows if r['method']==method and (r['p']==1 or method=='greedy')]
        ax.plot(sizes, [np.mean([r['ratio'] for r in selected if r['n']==n]) for n in sizes], marker='o', label=method)
    ax.set(xlabel='Vertices', ylabel='Mean cut / exact optimum', ylim=(0, 1.05), title='Max-Cut: p=1, mean over seeds')
    ax.legend(fontsize=8); fig.tight_layout(); fig.savefig(output/'ratios.png', dpi=150); plt.close(fig)
    fig, ax = plt.subplots(figsize=(8, 4.5))
    for method in ['exact', 'greedy', 'qiskit', 'pennylane']:
        selected = [r for r in rows if r['method']==method and (r['p']==1 or method in ['exact', 'greedy'])]
        ax.plot(sizes, [np.mean([r['seconds'] for r in selected if r['n']==n]) for n in sizes], marker='o', label=method)
    ax.set(xlabel='Vertices', ylabel='Mean seconds (log scale)', yscale='log', title='Runtime: p=1, mean over seeds')
    ax.legend(); fig.tight_layout(); fig.savefig(output/'runtime.png', dpi=150); plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sizes', type=int, nargs='+', default=[6, 8, 10, 12, 14, 16])
    parser.add_argument('--seeds', type=int, nargs='+', default=[1, 2, 3])
    parser.add_argument('--depths', type=int, nargs='+', default=[1, 2])
    parser.add_argument('--maxiter', type=int, default=12)
    parser.add_argument('--shots', type=int, default=512)
    parser.add_argument('--output', type=Path, default=Path('results'))
    args = parser.parse_args()
    if any(n < 2 or n > 20 for n in args.sizes) or args.shots < 1:
        parser.error('sizes must be 2..20 and shots must be positive')
    run(args.sizes, args.seeds, args.depths, args.maxiter, args.shots, args.output)

if __name__ == '__main__':
    main()
