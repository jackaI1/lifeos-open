# forecast-backtest-harness

I built a production forecasting harness to learn how the underlying idea works. This is a learning project.

## Try it

Python 3.9 or newer is required. From the project folder:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m forecast_harness
```

The command prints a result for each test period and saves `results/folds.csv` and `results/predictions.csv`. To use your own data, pass `--input production.csv`; the CSV needs `timestamp` and `production` columns, one row for every consecutive hour, unique timestamps, and nonnegative numeric production. Use `--output my-results` to choose another output folder. The defaults require at least 63 days of hourly data. Timestamps should use one consistent time zone and avoid daylight-saving gaps or duplicates.

## How it works

The example generates 90 days of repeatable production with day, evening and night shifts, weekday changes, a gradual trend and random noise. Validation checks the input for missing hours, duplicates and invalid values. Each prediction uses the hour, day of week, earlier production and past averages. It can use the actual value from the preceding hour, so this is a one-hour-ahead system, not a multi-day forecast made all at once.

A rolling-origin backtest moves through time in order: each fold trains on 28 days, calibrates on the next 7, and tests on the following 7. The calibration window adjusts the predicted ranges using past errors, without fitting on the test period. The three baselines use the last hour, the same hour one week earlier, and a short linear trend. Mean absolute error is the average size of a mistake; coverage is the fraction of actual values inside the predicted range. A lower error is better, while coverage and range width should be considered together.

The model uses scikit-learn's gradient-boosted trees to estimate the middle and two ends of a prediction range. Conformal calibration expands that range based on held-out errors, targeting 90% coverage. Coverage is measured rather than guaranteed for changing time series: shifts in production and correlated hours can make it miss the target. The acceptance rule checks error only; it does not require a particular coverage.

## Tests and limits

There are 1 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `forecast-backtest-harness-ci.yml`.
