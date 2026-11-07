# Comparing an ordering configuration

I keep randomized orders and a location rollout in separate studies. Their treatment labels have different meanings, and mixing them would give the wrong uncertainty estimates.

## CSV contract

One row is one synthetic order. Required columns:

| Column | Meaning |
| --- | --- |
| `order_id` | Globally unique order identifier |
| `experiment` | `ab` for randomized orders or `did` for the location rollout |
| `location` | Location identifier, consistently encoded |
| `period` | Integer week relative to the change; negative before, zero and up after |
| `arm` | 0 for control, 1 for treatment; in DiD, 1 identifies adopting locations even before adoption |
| `items` | Positive integer order size measured before configuration assignment |
| `correct` | 1 if accurate, otherwise 0 |
| `automated` | 1 if handled automatically, otherwise 0 |
| `service_seconds` | Positive finite service time |

Missing values, duplicate identifiers, invalid binary values and unsupported designs fail with an error rather than disappearing from the analysis. Extra columns are ignored. Use `--design ab` or `--design did` for a single study. All bundled observations are generated, with no copied customer or business records.

The A/B rows represent independent, post-change orders assigned with probability 0.5. Orders must not influence later orders, and `items` must be measured before exposure. The code cannot infer whether those assumptions hold from a CSV. It requires 30 orders per arm, at least five successes and failures in each binary outcome, and five expected observations per location/arm balance cell. For shared queues or recurring customers, assignment and inference would need to operate at the relevant cluster level.

The DiD panel requires at least ten locations per arm, four consecutive pre weeks, two post weeks and every location in every week. Arm stays constant within each location and all adopting locations change at period zero. The period count must be smaller than the location-cluster count to support the event study. Ten locations per arm is a floor, not a guarantee of reliable inference; the demo uses twenty. Staggered adoption is unsupported.

## Reproducible simulation

The default seed is 42. I generate 12,000 independent A/B orders and 32,000 DiD orders: 40 locations x 16 weeks x 50 orders. The planted effects are +0.035 accuracy, +0.10 automation and -18 seconds service time. These probability differences correspond to +3.5 and +10 percentage points. Effects can be changed through the immutable `Simulation` configuration in Python.

In the rollout, adopting locations start with different baselines. Both groups have the same underlying weekly trend. Service times also have location-week shocks that persist into later weeks, making location clustering useful. The optional `--broken-trends` scenario adds four seconds per week only at adopting locations, before and after the change. It creates an invalid counterfactual for a diagnostic demonstration, rather than a second real configuration effect.

`truth.json` records the simulation configuration but never enters estimation. The report records the input SHA-256, analysis seed, resample count and installed versions. No timestamp or machine path is needed to reproduce it. CSV generation and inference use separate random number generators.

## A/B inference

The estimand is treatment mean minus control mean. I use a two-sided pooled two-proportion z-test for each binary outcome. Service time uses a two-sided centered bootstrap test. Each arm is resampled independently; subtracting the observed mean difference centers the bootstrap differences at the zero-effect null. The Monte Carlo p-value is `(1 + extreme_draws) / (1 + draws)`, avoiding a false zero p-value. At least 999 draws are required; the default is 2,000, so the smallest reported bootstrap p-value is about 0.0005. Binary empirical bootstrap means can be sampled exactly with a binomial draw, avoiding large resampling arrays. Continuous resampling uses batches of 32.

All three outcomes receive percentile bootstrap 95% intervals. The binary bootstrap p-values are retained in JSON as supplementary checks; the prespecified primary binary tests remain the z-tests. Holm correction covers the three primary outcome p-values as one family at alpha 0.05. The intervals are pointwise, not adjusted for the whole family. The A/B and DiD families are separate because they are separate studies, not pooled evidence.

Assignment diagnostics use an exact binomial test for the 50:50 allocation, a Welch mean comparison for pre-assignment item count, and a location-by-arm chi-square test. Holm correction covers those three checks with a family warning level of 0.01. These can identify allocation or logging problems; nonsignificance is not proof of randomization.

The accuracy sample plan uses Cohen's arcsine difference between 0.90 and 0.93, a two-sided normal approximation, 80% power, equal arms and alpha `0.05/3`. Bonferroni planning is conservative for the subsequent Holm testing. The per-arm sample is rounded up. This is an advance target, not retrospective power based on the observed effect, and does not claim to power automation, service time or the location rollout. The public Python planning function also accepts alpha; the CLI keeps the prespecified 0.05 family level.

## Difference-in-differences

I first average orders within each location-week. Each cell gets equal weight, including with unequal order counts, so the estimand concerns the typical location-week rather than the typical order. For each outcome, statsmodels fits:

```text
mean_outcome(location, week) = location_baseline + week_baseline
                             + effect * adopting_location * post_change + error
```

The binary regressions are linear probability models, so their interaction coefficients are changes in probability, not odds ratios. In the balanced demo with equal order counts, the interaction equals the manual difference between the two groups' before-and-after changes. The fit uses `cov_type="cluster"`, location groups, the finite-sample covariance correction and t inference with `G-1` degrees of freedom, where G is the number of locations. Counting all 32,000 orders as independent would understate shared location uncertainty.

For the event study I replace the single interaction with adopting-location interactions for every week except -1, the reference week. I plot all coefficients and pointwise 95% location-clustered intervals. A joint clustered F/Wald test asks whether all pre-change interactions before -1 are zero. The placebo uses only negative weeks and pretends adoption happened at the midpoint of those weeks, -4 by default, with the same location/week controls. The three joint pre-trend tests and three placebo tests form one Holm-adjusted diagnostic family at 0.05.

Parallel trends is an assumption about unobserved outcomes without the intervention. Pre-trends and placebo checks can reject a comparison but cannot establish that assumption. They have limited power, and location-specific post-change shocks can still bias the result. I do not use this estimator for varying adoption dates or changing treatment membership.

## Decision policy and outputs

The report first holds if an assignment or trend diagnostic warns, then checks the A/B sample target. It holds for statistically supported harm and keeps testing for inconclusive results. Only beneficial, Holm-significant effects on all three outcomes in every selected design suggest a limited monitored rollout. This rule does not turn a synthetic result into a real-world recommendation or assess costs. Statistical significance alone also does not establish a useful business effect size.

`results.json` preserves unrounded effects, intervals, raw and adjusted p-values, diagnostic results, event coefficients and provenance. `report.md` explains the decision and limits. `event-study.png` visualizes all three rollout outcomes. Plots use a noninteractive backend and close their figure handles even if saving fails. There are no servers or background workers.

## Reference APIs

I use statsmodels' documented [two-proportion test](https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.proportions_ztest.html), [normal-approximation power calculation](https://www.statsmodels.org/stable/generated/statsmodels.stats.power.NormalIndPower.html), [Holm correction](https://www.statsmodels.org/stable/generated/statsmodels.stats.multitest.multipletests.html), and [clustered covariance with corrected degrees of freedom](https://www.statsmodels.org/stable/generated/statsmodels.regression.linear_model.RegressionResults.get_robustcov_results.html). `uv.lock` pins the tested 0.14 series of statsmodels rather than depending on a future API.
