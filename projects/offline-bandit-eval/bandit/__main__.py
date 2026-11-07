"""Run a reproducible offline dispatch evaluation."""
import argparse
import numpy as np
from .core import EpsilonGreedy, LinUCB, simulate, fit_reward_model, safe_policy, evaluate, bootstrap, true_value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--rows', type=int, default=10000)
    parser.add_argument('--bootstrap', type=int, default=200)
    args = parser.parse_args()
    rng = np.random.default_rng(args.seed)
    training = simulate(args.rows, EpsilonGreedy(3, 3, .5), rng)
    candidate = LinUCB(3, 3, alpha=1)
    simulate(args.rows, candidate, rng)
    log = simulate(args.rows, EpsilonGreedy(3, 3, .5), rng)
    proposed = np.array([candidate.probabilities(x) for x in log.context])
    target = safe_policy(proposed, log.probabilities, .2)
    model = fit_reward_model(training)
    estimates = evaluate(log, target, model)
    intervals = bootstrap(log, target, model, rng, args.bootstrap)
    print(f'Rows: {args.rows}; seed: {args.seed}; support threshold: 0.20')
    print(f'Simulator truth: {true_value(log.context, target):.4f}')
    print(f'Proposed decisions changed by safety rule: {np.mean(np.argmax(proposed, axis=1) != np.argmax(target, axis=1)):.1%}')
    for name, value in estimates.items():
        lo, hi = intervals[name]
        print(f'{name.upper():5s} {value:.4f}  95% bootstrap interval [{lo:.4f}, {hi:.4f}]')


if __name__ == '__main__':
    main()
