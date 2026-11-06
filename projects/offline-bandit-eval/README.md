# offline-bandit-eval

I built a small dispatch recommendation simulator to learn how the underlying idea works. This is a learning project.

## Try it

Python 3.9 or newer is required. From the project directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install '.[test]'
python -m bandit
python -m pytest -q
```

Use `python -m bandit --help` to change the seed, number of decisions, or bootstrap samples. The program prints the simulator's known value, estimates and intervals, and the share of proposed decisions changed by the safety rule.

## A reproducible run

With `python -m bandit --seed 42 --rows 10000 --bootstrap 200`, I got the following simulated success rates. The interval is a range from repeatedly resampling the recorded decisions, not a guarantee about a real mine.

| Method | Estimate | 95% bootstrap interval |
| --- | ---: | ---: |
| Known simulator value | 0.5270 | |
| Inverse propensity scoring | 0.5291 | 0.5149 to 0.5411 |
| Self-normalized IPS | 0.5269 | 0.5144 to 0.5373 |
| Doubly robust | 0.5270 | 0.5145 to 0.5381 |

The support rule changed 7.7% of proposed decisions in this run. Numbers can vary slightly across platforms.

## How it works

An epsilon-greedy logger usually chooses the action with the best learned score but sometimes explores other actions. LinUCB is another contextual bandit: it scores each action using both its estimated reward and uncertainty. I train a LinUCB candidate separately, then evaluate its fixed recommendations on a fresh log. The logger records the probability of each choice at the time, including its history-dependent updates.

Before evaluation, the safety rule removes candidate actions whose logged probability for that decision is below 0.20. It renormalizes the remaining probabilities, or falls back to the most supported action if none of the candidate's choices survive. It raises an error if no action meets the threshold. This is a probability-based overlap guard, not a guarantee that enough similar real-world cases exist. The estimate applies to the resulting guarded policy, not the original candidate.

Inverse propensity scoring (IPS) weights each matching logged outcome by the target probability divided by the chance the logger chose it. Self-normalized IPS divides by the sum of those weights to reduce sensitivity to their overall scale. Doubly robust evaluation combines these weights with a separate linear outcome model fitted on an independent training log. Bootstrap intervals resample evaluation rows while keeping that fitted model fixed.

All three methods need correct logged probabilities and sufficient overlap. The simulator exposes the entire conditional logging distribution to enforce the guard; real logs must retain it or obtain a reliable estimate. The logger adapts over time, so row bootstrap intervals are illustrative and may not have nominal coverage under dependence. The simulator uses a simple linear reward model, and its results do not establish real dispatch safety or performance.

## Tests and limits

There are 1 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `offline-bandit-eval-ci.yml`.
