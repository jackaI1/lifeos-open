# Allocation and payment coverage

20,000 simulated paths, 20 years, seed 2026.
Calibration: 1976-2025 (50 annual observations). Nominal USD throughout.

Starting assets: $1,000,000. Liability present value: $1,126,416. Initial funded ratio: 88.8% (assets divided by discounted payments).

The optimizer minimizes annual asset variance at the chosen return floor. It does not minimize missed payments. The separate coverage test checks every payment.

## Allocation

| Asset | Baseline | Changed correlations |
|---|---:|---:|
| us_equity | 11.40% | 7.23% |
| treasury_10y | 0.00% | 0.00% |
| baa_credit | 35.85% | 44.13% |
| cash_3m | 52.74% | 48.65% |

Expected annual return: 7.00% -> 7.00%; annual volatility: 4.93% -> 5.64%.

## Payment coverage

| Case | Ever miss a payment | Expected unpaid PV | Mean ending assets |
|---|---:|---:|---:|
| baseline | 11.30% | $7,595.00 | $547,169.53 |
| equal_weight_reference | 6.86% | $6,050.32 | $1,106,512.64 |
| changed_model_fixed_weights | 15.45% | $12,652.93 | $558,337.96 |
| changed_model_reoptimized | 15.18% | $12,391.17 | $558,013.25 |

## Model-change reconciliation

Changed assumption: log-return correlation R becomes (1 - 0.35) R + 0.35 11'. Each asset's return distribution stays the same. Shared random draws reduce noise.

The first effect changes correlations while holding the old allocation. The second reoptimizes under the new model. Their sum equals the total change. This is an ordered bridge; reversing the order can give a different attribution.

| Metric | Assumption effect | Allocation effect | Total change |
|---|---:|---:|---:|
| shortfall_probability | +4.1450 pp | -0.2650 pp | +3.8800 pp |
| expected_pv_unpaid | +5,057.9300 USD | -261.7596 USD | +4,796.1704 USD |
| mean_terminal_assets | +11,168.4249 USD | -324.7114 USD | +10,843.7135 USD |
| p05_terminal_assets | +0.0000 USD | +0.0000 USD | +0.0000 USD |
| mean_payment_coverage | -0.6215 pp | +0.0322 pp | -0.5893 pp |

Paired Monte Carlo standard error for the total missed-payment probability change: 0.1396 percentage points. This measures sampling noise, not uncertainty about future markets. The JSON includes paired errors for all mean-based metrics; no error is estimated for the fifth percentile.

## Reading the outputs

- `report.json`: full assumptions, calibration, weights, coverage and reconciliation.
- `yearly.csv`: payments, asset balances and funding ratios for each year and case.
- `frontier.csv`: minimum-variance allocations across eight return floors.

Historical calibration is an illustration, not a forecast or investment advice. Independent annual lognormal returns omit fat tails, regime shifts and serial dependence. Bills use a historical rate proxy. Liabilities are synthetic; no fees, taxes, contributions, duration hedging or interest-rate revaluation are modeled.
