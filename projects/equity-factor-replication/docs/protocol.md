# Research protocol

Written and committed before downloading return files or calculating results. This is a retrospective, public-data replication, not a prospective preregistration.

## Question and hypothesis

Jegadeesh and Titman (1993) report that buying past winners and selling past losers earns positive returns. My directional hypothesis is that the mean monthly winner-minus-loser return is positive, including in a reserved later period. The null is a mean at or below zero. The primary series is the value-weighted highest minus lowest decile in French's monthly momentum portfolios, with no costs. I will report failure as well as success, without changing this choice after seeing results.

## Scope and data

Use only public Ken French Data Library monthly return files, frozen with URL and SHA-256 provenance. Stock momentum: `10_Portfolios_Prior_12_2_CSV.zip`, both value- and equal-weighted returns. Industry experiment: value-weighted `49_Industry_Portfolios_CSV.zip`. Returns are percentages in the source and decimals internally. Reject duplicate months, calendar gaps, missing selected returns and non-finite data rather than fill them.

This is a conceptual replication, not an exact recreation of the paper's tables. French sorts stocks monthly on returns from t-12 through t-2 using NYSE breakpoints. The published study uses stock-level formation and overlapping holding portfolios; aggregate returns cannot recreate those holdings, alternate stock-level formation windows, actual turnover, or the original universe. I will not average monthly momentum returns to pretend to recreate longer holding portfolios.

## Fixed split and experiments

- In-sample: January 1965 to December 1989. Reserved out-of-sample: January 1990 to December 2025. No parameter selection uses the reserved period; the primary strategy is fixed above. Both periods are already historical and known to the literature, so the reserved sample is not independent of prior scientific knowledge.
- Also report full 1965-2025 and fixed later subperiods 1990-2007, 2008-2009 and 2010-2025. Exclude partial 2026 even if supplied by the source.
- Stock strategies: value-weighted and equal-weighted decile spreads with the fixed French formation window.
- Separate industry sensitivity: rank the 49 industry portfolios by compounded returns over 3, 6 or 12 completed months ending t-2, skip t-1, then hold an equal-weighted top-five minus bottom-five industry spread for month t. Use historical warmup before 1965. Break ties by source column order. These are industry signals, not alternate stock-momentum estimates. Never use future or current returns to rank. Do not substitute the industry experiment for the primary result.
- Cost scenarios: 0, 10, 25, 50 basis points per dollar traded (one basis point is 0.01%). Assume each $1 long and $1 short leg is fully sold and replaced monthly: $4 traded per month. Net return = gross spread minus 4 * bps / 10,000. This is a transparent scenario, not measured turnover. Financing, borrow fees, market impact, taxes and capacity are omitted. Break-even cost is monthly gross mean * 10,000 / 4.

## Inference and reporting

Report monthly count, annualized arithmetic mean (12 times monthly mean), annualized sample-volatility Sharpe (sqrt(12) times mean / standard deviation), Newey-West mean standard error with six Bartlett-weighted lags, one-sided asymptotic normal p-value, and a two-sided 95% HAC interval for the annualized mean. Short crisis windows have weak normal approximations. Sharpe uses the zero-investment spread without subtracting the risk-free rate. These returns use $1 long and $1 short notionals; they are not a fund return on required capital.

Correct ALL 5 strategies x 4 costs x 6 periods = 120 directional mean tests as one family using Holm's step-down adjustment at 5%. Holm allows dependence between tests, but the underlying p-values are asymptotic. It corrects reported mean tests, not Sharpe estimates or confidence intervals. Report raw and adjusted p-values and never call unadjusted significance a corrected finding. No search for a best Sharpe and no deflated Sharpe claim.

Generate the short report, all empirical tables, machine-readable results, monthly returns and figures with one command. Figures will show cumulative arithmetic spreads (not investable compounded wealth), cost sensitivity and industry formation sensitivity. Highlight sign reversals, loss of corrected significance, cost break-even and the crisis period. Include source, method and proxy limitations alongside results.

## References

- [Jegadeesh and Titman (1993), Returns to Buying Winners and Selling Losers](https://doi.org/10.1111/j.1540-6261.1993.tb04702.x).
- [French monthly momentum construction](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_10_port_form_pr_12_2.html).
- [French industry portfolios](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/Data_Library/det_49_ind_port.html).
- [Newey and West (1987), HAC covariance estimation](https://doi.org/10.2307/1913610).
- [Holm (1979), A Simple Sequentially Rejective Multiple Test Procedure](https://doi.org/10.2307/4615733).
