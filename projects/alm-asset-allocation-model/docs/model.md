# Model conventions and reconciliation

## Calibration and simulation

The input is a complete annual panel of simple returns `r`. I transform each observation to `x = log(1 + r)`, estimate the column means `m`, and calculate sample covariance `S` with denominator `n - 1`. No extra annualization is applied to annual data. There is no train/test performance claim: this is a historical calibration for a forward-looking synthetic experiment.

For each year in each path I generate an independent standard normal vector `z` and set:

```text
x = m + L z                  L L' = S
r = exp(x) - 1
mu_i = exp(m_i + S_ii/2) - 1
C_ij = (1 + mu_i)(1 + mu_j)(exp(S_ij) - 1)
```

`L` is the symmetric positive-semidefinite square root, constructed from an eigendecomposition. This permits singular covariance, perfect correlation, and zero variance without adding jitter. Eigenvalues within floating point tolerance of zero are clipped to zero; materially indefinite inputs are rejected. The simulator and optimizer share the same implied arithmetic mean `mu` and covariance `C`. Historical arithmetic means are not mixed with log-return covariance.

## Strategic allocation

The optimizer solves the convex quadratic problem:

```text
minimize       w' C w
subject to     sum(w) = 1
               mu' w >= target_return
               0 <= w_i <= max_weight
```

I first solve a linear program for the maximum feasible return. An unreachable target fails before simulation. SciPy's [SLSQP solver](https://docs.scipy.org/doc/scipy/reference/optimize.minimize-slsqp.html) then minimizes variance with analytic gradients. I check convergence and all constraints before accepting the weights. There is no leverage, short selling, or turnover penalty. The efficient-frontier output uses eight feasible return floors; floors below the global minimum-variance portfolio's return can produce the same portfolio.

The objective is annual asset risk. It does not optimize cash-flow shortfall, hedge liability duration, or promise a unique allocation in degenerate cases. The equal-weight reference has a different expected return and is a context comparison rather than a return-matched optimality test.

## Liabilities and cash-flow coverage

With first payment `P`, annual growth `g`, discount rate `d`, and horizon `T`:

```text
payment_t = P (1 + g)^(t - 1)                  t = 1,...,T
PV_0 = sum_t payment_t / (1 + d)^t
assets_before_payment_t = assets_after_payment_(t-1) * (1 + w' r_t)
paid_t = min(assets_before_payment_t, payment_t)
unpaid_t = payment_t - paid_t
assets_after_payment_t = assets_before_payment_t - paid_t
```

Every scenario starts with the same initial assets. A path fails if any payment is short by more than `1e-8` USD, an absolute numerical tolerance. Its discounted unpaid amount still records every positive gap, including smaller residuals. Shortfalls are reported, not borrowed or shifted into later payments. A depleted portfolio remains depleted because there are no contributions. Remaining money is rebalanced to strategic weights after every payment.

The reported prepayment funded ratio at time `t` divides assets before payment by the value at that date of all still-due payments, including the payment due immediately. The final year therefore uses the final payment as denominator, not a zero remaining-liability balance. Payment coverage is total nominal payments made divided by total nominal payments due; it is not discounted. Ending assets are measured after the final payment. Expected unpaid PV uses the same constant discount rate as initial liability PV.

## Controlled model change

For blend `b`, I change log-return correlations toward perfect positive co-movement:

```text
R_changed = (1 - b) R + b 11'          0 <= b <= 1
S_changed = (1 - b) S + b sigma sigma'
```

The covariance expression is also well-defined for zero-variance assets. A convex combination of these positive-semidefinite matrices remains positive semidefinite. Marginal log means and variances, and thus marginal arithmetic moments, remain unchanged. Changes to asset arithmetic correlations follow from the lognormal transformation; they are not numerically identical to the log-correlation blend.

I generate one normal-shock cube and reuse it in all three cases:

1. Baseline model with baseline optimized weights, `A`.
2. Changed model with baseline weights, `B`.
3. Changed model with weights reoptimized under that model, `C`.

For each metric, the assumption effect is `B - A`, the allocation effect is `C - B`, and the total is `C - A`. `bridge_residual` checks their sum at full precision. The same bridge is reported for missed-payment probability, expected discounted unpaid cash, mean ending assets, fifth-percentile ending assets, and mean payment coverage. It is an ordered sequential attribution, not a unique or order-independent causal allocation. There is no assertion that reoptimization improves every liability metric.

For mean-based metrics I calculate the standard error of each paired path difference: `sample_std(differences, ddof=1) / sqrt(number_of_paths)`. For missed-payment probability the path values are zero or one. This preserves the covariance between paired experiments; it does not assume independent samples. No standard error is supplied for the quantile metric. The displayed bridge in percentage points uses `100 * probability_difference`, not a relative percent change.

Common shocks make exact zero-change checks possible and usually reduce comparison noise, but the reported changes still have Monte Carlo error. None of these errors accounts for estimated-parameter uncertainty, unstable history, future regimes, or the simplified liability assumptions. With independent annual draws this model can understate clustered bad years and tail losses.

## Reproducibility and resource bounds

The example pins 20,000 paths, 20 years, seed 2026, a historical CSV hash, and locked dependencies. The report records Python, NumPy and SciPy versions. The saved JSON omits machine-specific absolute paths. Identical inputs reproduce the same run in the same environment; other numerical libraries can change the last few digits.

Configuration files reject unknown fields. Scenario arrays are capped at eight million entries per cube; the baseline cube is released before the stressed one is built. The normal-shock cube and a simulated-return cube are the main allocations. There is no web server, background poller, or browser process. Runs return normally and write four bounded summary files instead of all simulated paths.
