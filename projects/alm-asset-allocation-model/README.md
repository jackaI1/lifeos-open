# alm-asset-allocation-model

I built a savings-and-payments simulator to learn how the underlying idea works. This is a learning project.

## Change the example

Edit [examples/demo.json](examples/demo.json), then run again. The history path is relative to the configuration file, so the command also works from another directory when given an absolute config path.

```sh
uv run alm-model --config examples/demo.json --output reports/my-case
uv run alm-model --scenarios 5000 --seed 42 --output reports/quick-check
```

The inputs I change most often are:

| Input | Meaning | Example value |
|---|---|---:|
| `initial_assets` | Money available at the start | 1000000 |
| `years` | Number of end-of-year payments | 20 |
| `first_payment` | Amount due at the end of year one | 70000 |
| `payment_growth` | Annual increase in payments | 0.02 |
| `discount_rate` | Rate for expressing payments in today's dollars | 0.04 |
| `target_return` | Minimum expected annual portfolio return | 0.07 |
| `max_weight` | Largest allowed share in any one asset | 0.65 |
| `correlation_blend` | How far correlations move toward moving together perfectly | 0.35 |

Rates and weights are decimals: `0.07` means 7%. The CLI rejects impossible return targets and oversized scenario requests. Setting `correlation_blend` to zero makes both reconciliation effects zero.

## Read the output

- `report.md` explains the allocation, payment results and model-change reconciliation.
- `report.json` contains the exact assumptions, data hash, calibration matrices, weights, results and simulation errors. It includes library versions for reproducibility.
- `yearly.csv` shows liabilities, balances after payment, missed-payment rates and funding ratios year by year.
- `frontier.csv` compares eight minimum-volatility allocations at different expected-return targets. This set of choices is an efficient frontier.

These four files are also saved in [examples/output](examples/output). Dollar amounts are nominal USD unless described as present value. A zero ending balance does not prove success: a path can end at zero after missing several payments, which is why I track unpaid amounts separately.

## Data and model

I use 50 annual observations from 1976 through 2025 in [Aswath Damodaran's NYU Stern historical-return workbook](https://www.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls). The four series are US stocks including dividends, 10-year Treasury bond returns, Baa corporate bond returns, and the three-month Treasury bill rate as a cash-return proxy. The source's bond returns include price movements; they are not just bond yields. [Data notes](data/README.md) document the extraction, column mapping and hashes.

I fit the averages and covariance of log returns, which describe growth and joint variation. I simulate correlated lognormal returns, so an asset cannot lose more than its entire value in a year. The allocation is long-only, fully invested and capped at 65% per asset by default. A constrained minimum-variance optimizer uses the arithmetic moments implied by the same simulation model.

For the asset-liability model, assets grow during each year, the payment is made at year-end, and the remaining assets are rebalanced. Payments that cannot be covered are recorded as unpaid, with no borrowing or new money added. The reconciliation first changes correlations with the old weights and then reoptimizes. Its two effects add to the total change; their attribution depends on this order. [Model details and equations](docs/model.md) explain the conventions and uncertainty estimates.

This is a synthetic planning experiment, not a forecast or investment advice. It assumes independent years, stable return distributions and fixed payment growth. It omits market regimes, fat tails, fees, taxes, interest-rate revaluation of liabilities and duration hedging. Historical cash-rate variation is not a forecast of future short rates.

## Tests and limits

There are 3 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Retained project workflows: `alm-asset-allocation-model-ci.yml`. Their commands use this folder and their triggers use its paths.
