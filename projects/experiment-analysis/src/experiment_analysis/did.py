"""Simultaneous adoption, balanced location-period panel, location-clustered OLS."""

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from .ab import holm_adjust
from .schema import METRICS, select_design


def _fit(formula: str, panel: pd.DataFrame):
    return smf.ols(formula, panel).fit(
        cov_type="cluster",
        cov_kwds={"groups": panel.location, "use_correction": True, "df_correction": True},
        use_t=True,
    )


def _coefficient(fit, name: str) -> dict:
    low, high = fit.conf_int().loc[name]
    return {
        "effect": float(fit.params[name]),
        "se": float(fit.bse[name]),
        "ci_low": float(low),
        "ci_high": float(high),
        "p": float(fit.pvalues[name]),
    }


def analyze_did(rows: pd.DataFrame) -> dict:
    data = select_design(rows, "did")
    if data.groupby("location").arm.nunique().max() != 1:
        raise ValueError("DiD arm must be constant within each location")
    locations_per_arm = data.groupby("arm").location.nunique()
    if locations_per_arm.min() < 10:
        raise ValueError("DiD needs >=10 locations per arm for clustered inference")
    periods = sorted(data.period.unique())
    pre, post = [p for p in periods if p < 0], [p for p in periods if p >= 0]
    if (
        len(pre) < 4
        or len(post) < 2
        or periods != list(range(int(min(periods)), int(max(periods)) + 1))
    ):
        raise ValueError("DiD needs consecutive periods, >=4 pre and >=2 post; change at period 0")
    panel = data.groupby(["location", "period", "arm"], as_index=False)[list(METRICS)].mean()
    if not (panel.groupby("location").size() == len(periods)).all():
        raise ValueError("DiD requires every location in every period (balanced panel)")
    if len(periods) - 1 >= data.location.nunique():
        raise ValueError("Event study requires more location clusters than event coefficients")
    panel["active"] = panel.arm * (panel.period >= 0)
    terms = []
    for i, period in enumerate(p for p in periods if p != -1):
        name = f"event_{i}"
        panel[name] = panel.arm * (panel.period == period)
        terms.append((int(period), name))
    estimates, diagnostics, event_studies = [], [], {}
    # A false rollout halfway through the PRE period, never using actual post data.
    placebo_cutoff = int(pre[len(pre) // 2])
    placebo_panel = panel.loc[panel.period < 0].copy()
    placebo_panel["fake_active"] = placebo_panel.arm * (placebo_panel.period >= placebo_cutoff)
    for metric in METRICS:
        fit = _fit(f"{metric} ~ active + C(location) + C(period)", panel)
        estimate = _coefficient(fit, "active")
        estimate.update(
            metric=metric,
            clusters=int(data.location.nunique()),
            df_inference=int(fit.df_resid_inference),
        )
        estimates.append(estimate)
        event_fit = _fit(
            f"{metric} ~ C(location) + C(period) + " + " + ".join(name for _, name in terms), panel
        )
        event_studies[metric] = [
            dict(period=p, **_coefficient(event_fit, name)) for p, name in terms
        ]
        event_studies[metric].append(
            {"period": -1, "effect": 0.0, "ci_low": 0.0, "ci_high": 0.0, "reference": True}
        )
        restrictions = np.zeros((len(pre) - 1, len(event_fit.params)))
        for index, (_, name) in enumerate((p, n) for p, n in terms if p < -1):
            restrictions[index, event_fit.params.index.get_loc(name)] = 1
        joint = event_fit.wald_test(restrictions, use_f=True, scalar=True)
        diagnostics.append({"metric": metric, "check": "pre-trends", "p": float(joint.pvalue)})
        placebo = _fit(f"{metric} ~ fake_active + C(location) + C(period)", placebo_panel)
        diagnostics.append(
            {"metric": metric, "check": "placebo", **_coefficient(placebo, "fake_active")}
        )
    holm_adjust(estimates)
    holm_adjust(diagnostics)  # One family: three lead tests and three placebo tests.
    return {
        "metrics": estimates,
        "diagnostics": diagnostics,
        "event_studies": event_studies,
        "diagnostic_flag": any(d["significant"] for d in diagnostics),
        "placebo_cutoff": placebo_cutoff,
        "location_periods": len(panel),
        "orders": len(data),
        "covariance": "location-clustered, small-sample correction, t(G-1)",
        "weighting": "equal location-period means",
    }
