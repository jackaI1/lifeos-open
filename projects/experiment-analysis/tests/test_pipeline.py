import json

import matplotlib.pyplot as plt
import pandas as pd
import pytest

from experiment_analysis import Simulation, simulate
from experiment_analysis.cli import main
from experiment_analysis.report import recommendation, write_report
from experiment_analysis.schema import validate_orders


def test_seed_reproduces_data_and_truth():
    first, truth = simulate()
    second, second_truth = simulate()
    pd.testing.assert_frame_equal(first, second)
    assert truth == second_truth
    assert len(first) == 44000


def test_csv_report_roundtrip_without_ground_truth(orders, tmp_path):
    source = tmp_path / "input.csv"
    orders.to_csv(source, index=False)
    result = write_report(source, tmp_path / "report", draws=999)
    assert json.loads((tmp_path / "report/results.json").read_text()) == result
    text = (tmp_path / "report/report.md").read_text()
    assert "limited, monitored rollout" in text
    assert "Imported order data" in text
    assert "placebo" in text and "Holm" in text
    assert (tmp_path / "report/event-study.png").read_bytes().startswith(b"\x89PNG")
    assert not plt.get_fignums()


def test_cli_demo_and_plan(tmp_path, capsys):
    assert main(["plan"]) == 0
    assert "Required orders per arm" in capsys.readouterr().out
    assert main(["demo", "--output", str(tmp_path), "--draws", "999"]) == 0
    assert (tmp_path / "orders.csv").exists()
    assert json.loads((tmp_path / "truth.json").read_text())["synthetic"]
    assert json.loads((tmp_path / "results.json").read_text())["provenance"]["synthetic"]


def test_cli_analyzes_single_design(orders, tmp_path):
    source = tmp_path / "ab.csv"
    orders.loc[orders.experiment == "ab"].to_csv(source, index=False)
    assert (
        main(
            ["analyze", str(source), "--design", "ab", "--output", str(tmp_path), "--draws", "999"]
        )
        == 0
    )
    assert "did" not in json.loads((tmp_path / "results.json").read_text())


def test_cli_bad_input_has_actionable_error(tmp_path, capsys):
    with pytest.raises(SystemExit) as exc:
        main(["analyze", str(tmp_path / "absent.csv"), "--output", str(tmp_path)])
    assert exc.value.code == 2
    assert "error:" in capsys.readouterr().err


@pytest.mark.parametrize("flag", ["randomization", "trend", "sample", "harm", "uncertain"])
def test_recommendation_guards(flag):
    metrics = [
        {"metric": m, "effect": e, "significant": True}
        for m, e in [("correct", 0.03), ("automated", 0.10), ("service_seconds", -18)]
    ]
    result = {
        "ab": {
            "randomization_flag": flag == "randomization",
            "power_plan": {"sample_target_met": flag != "sample"},
            "metrics": metrics,
        },
        "did": {"diagnostic_flag": flag == "trend", "metrics": metrics},
    }
    if flag == "harm":
        metrics[0]["effect"] = -0.03
    if flag == "uncertain":
        metrics[0]["significant"] = False
    assert "Try a limited" not in recommendation(result)


@pytest.mark.parametrize(
    "problem",
    [
        "missing",
        "duplicate",
        "nan",
        "infinite",
        "bad_binary",
        "negative_time",
        "fractional_period",
        "unknown_design",
    ],
)
def test_invalid_rows_fail_closed(orders, problem):
    rows = orders.head(100).copy()
    if problem == "missing":
        rows = rows.drop(columns="arm")
    elif problem == "duplicate":
        rows.loc[1, "order_id"] = rows.loc[0, "order_id"]
    elif problem == "nan":
        rows.loc[0, "service_seconds"] = float("nan")
    elif problem == "infinite":
        rows.loc[0, "service_seconds"] = float("inf")
    elif problem == "bad_binary":
        rows.loc[0, "correct"] = 2
    elif problem == "negative_time":
        rows.loc[0, "service_seconds"] = -1
    elif problem == "fractional_period":
        rows["period"] = 0.5
    else:
        rows.loc[0, "experiment"] = "unknown"
    with pytest.raises(ValueError):
        validate_orders(rows)


def test_simulator_rejects_invalid_configuration():
    with pytest.raises(ValueError):
        simulate(Simulation(locations=5))


def test_later_harm_is_not_hidden_by_an_inconclusive_outcome():
    result = {
        "did": {
            "diagnostic_flag": False,
            "metrics": [
                {"metric": "correct", "effect": 0.001, "significant": False},
                {"metric": "service_seconds", "effect": 20, "significant": True},
            ],
        }
    }
    assert "evidence of harm" in recommendation(result)
