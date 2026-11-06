# experiment-analysis

I built an ordering-change comparison tool to learn how the underlying idea works. This is a learning project.

## What I compare

The demo makes 44,000 synthetic orders in two separate studies:

- **A/B test:** 12,000 independent orders receive either the old or new configuration at random. I check that the groups have roughly equal sizes and similar locations and order sizes before comparing their outcomes.
- **Difference-in-differences:** 20 locations change configuration and 20 keep the old one, over eight weeks before and eight weeks after the change. I compare how much the adopting group changes against how much the unchanged group changes. This removes differences that stay fixed by location and changes that affect everyone each week.

The second comparison relies on **parallel trends**: without the configuration change, the groups would have continued moving similarly. My chart and pre-change checks can reveal a problem with that assumption, but cannot prove it. A **placebo test** pretends the rollout happened four weeks early, when it should have had no effect.

## Run another comparison

```sh
# Estimate the order count needed before starting an accuracy experiment.
uv run experiment-analysis plan --baseline 0.90 --improvement 0.03 --power 0.80

# Make an intentionally misleading rollout. The report should say to hold.
uv run experiment-analysis demo --broken-trends --output artifacts/broken-trends

# Reanalyze the generated CSV without using the known simulated effects.
uv run experiment-analysis analyze artifacts/demo/orders.csv --output artifacts/reanalysis

# Analyze only one study when a CSV contains just that design.
uv run experiment-analysis analyze artifacts/demo/orders.csv --design ab --output artifacts/ab
```

Every analysis writes `report.md` and `results.json`; location analyses also write `event-study.png`. The demo additionally writes `orders.csv` and `truth.json`, which records the effects planted in the simulation. The analysis reads only the CSV. A seed, input fingerprint and package versions are saved with the results so I can trace a report back to its inputs.

I can also call the package from Python:

```python
from experiment_analysis import simulate, analyze_ab, analyze_did

orders, truth = simulate()
ab = analyze_ab(orders)
rollout = analyze_did(orders)
print(ab["metrics"][0])
```

[The input format and analysis design](docs/design.md) explain how to prepare another CSV and what the comparisons assume. The A/B calculation is for independent orders. Repeat customers, shared kitchen queues, and rollouts on different dates need a different design.

## Tests and limits

There are 4 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: (removed workflow).

The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.
