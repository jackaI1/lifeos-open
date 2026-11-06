import numpy as np
import pytest
from scipy import stats

from experiment_analysis import Simulation, analyze_did, simulate


def test_recovers_effects_with_location_clustering(orders):
    result = analyze_did(orders)
    for metric, truth, tolerance in zip(
        result["metrics"], [0.035, 0.10, -18], [0.015, 0.025, 2], strict=True
    ):
        assert metric["effect"] == pytest.approx(truth, abs=tolerance)
        assert metric["ci_low"] < truth < metric["ci_high"]
        assert metric["significant"]
        assert metric["clusters"] == 40
        assert metric["df_inference"] == 39
        assert (metric["ci_high"] - metric["effect"]) / metric["se"] == pytest.approx(
            stats.t.ppf(0.975, 39)
        )
    assert not result["diagnostic_flag"]
    assert result["placebo_cutoff"] == -4
    for events in result["event_studies"].values():
        assert len(events) == 16
        assert next(e for e in events if e["period"] == -1)["reference"]


def test_twfe_matches_manual_difference_of_differences(orders):
    data = orders.loc[orders.experiment == "did"].copy()
    data["post"] = data.period >= 0
    means = data.groupby(["arm", "post"]).service_seconds.mean()
    manual = means[1, True] - means[1, False] - means[0, True] + means[0, False]
    result = analyze_did(data)
    assert result["metrics"][2]["effect"] == pytest.approx(manual, abs=1e-10)


def test_broken_trends_trigger_lead_and_placebo_warnings():
    rows, _ = simulate(Simulation(differential_service_trend=4))
    result = analyze_did(rows)
    diagnostics = [r for r in result["diagnostics"] if r["metric"] == "service_seconds"]
    assert all(r["significant"] for r in diagnostics)
    assert result["diagnostic_flag"]


def test_placebo_never_uses_post_change_outcomes(orders):
    changed = orders.copy()
    changed.loc[(changed.experiment == "did") & (changed.period >= 0), "service_seconds"] += 999
    before, after = analyze_did(orders), analyze_did(changed)
    for a, b in zip(before["diagnostics"], after["diagnostics"], strict=True):
        if a["check"] == "placebo":
            assert a == b


def test_null_did_does_not_invent_effects():
    rows, _ = simulate(
        Simulation(seed=10, accuracy_effect=0, automation_effect=0, service_effect=0)
    )
    result = analyze_did(rows)
    assert not any(m["significant"] for m in result["metrics"])


def test_repeating_orders_does_not_invent_more_independent_locations(orders):
    # Duplication is only for this statistical check; IDs remain unique.
    repeated = orders.loc[orders.experiment == "did"].copy()
    import pandas as pd

    repeated = pd.concat([repeated] * 3, ignore_index=True)
    repeated["order_id"] = np.arange(len(repeated))
    original, copied = analyze_did(orders), analyze_did(repeated)
    for a, b in zip(original["metrics"], copied["metrics"], strict=True):
        assert a["se"] == pytest.approx(b["se"], abs=1e-10)
        assert a["clusters"] == b["clusters"]


@pytest.mark.parametrize("problem", ["missing_cell", "switch_arm", "few_clusters", "few_pre"])
def test_rejects_unsupported_panels(orders, problem):
    data = orders.loc[orders.experiment == "did"].copy()
    if problem == "missing_cell":
        data = data.loc[~((data.location == 0) & (data.period == -1))]
    elif problem == "switch_arm":
        data.loc[(data.location == 0) & (data.period == 0), "arm"] = 1
    elif problem == "few_clusters":
        data = data.loc[data.location != 0]
        data = data.loc[~data.location.isin(range(1, 11))]
    else:
        data = data.loc[data.period >= -3]
    with pytest.raises(ValueError):
        analyze_did(data)
