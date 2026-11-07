import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

from alm_model.cli import write_report
from alm_model.experiment import load_config, run_experiment

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def config():
    return {**load_config(ROOT / "examples/demo.json"), "scenarios": 2500}


@pytest.fixture(scope="module")
def report():
    config = {**load_config(ROOT / "examples/demo.json"), "scenarios": 2500}
    return run_experiment(config)


def test_bridge_ties_exactly_and_reports_paired_uncertainty(report):
    for metric, row in report["reconciliation"].items():
        assert row["assumption_effect"] + row["allocation_effect"] == pytest.approx(
            row["total_change"], abs=1e-9
        )
        assert abs(row["bridge_residual"]) < 1e-9
        if metric != "p05_terminal_assets":
            assert all(v >= 0 for v in row["paired_mc_standard_error"].values())
    assert report["reconciliation"]["shortfall_probability"]["assumption_effect"] > 0
    assert len(report["frontier"]) == 8
    for allocation in report["allocations"].values():
        assert sum(allocation["weights"].values()) == pytest.approx(1)
        assert max(allocation["weights"].values()) <= 0.65 + 1e-8
        assert allocation["expected_return"] >= 0.07 - 1e-8


def test_unchanged_model_has_zero_reconciliation_and_zero_paired_error(config):
    report = run_experiment({**config, "correlation_blend": 0})
    for row in report["reconciliation"].values():
        for key in ("assumption_effect", "allocation_effect", "total_change", "bridge_residual"):
            assert row[key] == 0
        if "paired_mc_standard_error" in row:
            assert set(row["paired_mc_standard_error"].values()) == {0}


def test_same_seed_reproduces_every_output(config, report):
    assert run_experiment(config) == report


def test_json_and_csv_reports_are_complete_and_do_not_leak_local_paths(tmp_path, report):
    write_report(report, tmp_path)
    loaded = json.loads((tmp_path / "report.json").read_text())
    assert loaded == report
    assert "/Users/" not in (tmp_path / "report.json").read_text()
    assert len((tmp_path / "yearly.csv").read_text().splitlines()) == 61
    assert len((tmp_path / "frontier.csv").read_text().splitlines()) == 9
    assert "percentage points" in (tmp_path / "report.md").read_text()


def test_cli_runs_from_another_directory(tmp_path):
    result = subprocess.run(
        [
            str(ROOT / ".venv/bin/alm-model"),
            "--config",
            str(ROOT / "examples/demo.json"),
            "--scenarios",
            "200",
            "--output",
            str(tmp_path / "output"),
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert (tmp_path / "output/report.md").exists()


def test_cli_rejects_infeasible_target_without_partial_report(tmp_path, config):
    config["target_return"] = 0.99
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    output = tmp_path / "output"
    result = subprocess.run(
        [str(ROOT / ".venv/bin/alm-model"), "--config", str(path), "--output", str(output)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 2
    assert "infeasible" in result.stderr
    assert not output.exists()


@pytest.mark.parametrize(
    "key,value",
    [
        ("scenarios", 1),
        ("scenarios", True),
        ("scenarios", 250001),
        ("years", 101),
        ("seed", -1),
        ("correlation_blend", 1.1),
        ("payment_growth", -1),
        ("discount_rate", -1),
        ("initial_assets", 0),
        ("first_payment", "70000"),
        ("target_return", np.nan),
    ],
)
def test_invalid_config_rejected(config, key, value):
    with pytest.raises(ValueError):
        run_experiment({**config, key: value})


def test_memory_budget_rejects_oversize_cube_before_allocation(config):
    with pytest.raises(ValueError, match="8 million"):
        run_experiment({**config, "scenarios": 250000})


def test_unknown_config_keys_rejected(tmp_path, config):
    path = tmp_path / "config.json"
    path.write_text(json.dumps({**config, "paymant_growth": 0.02}))
    with pytest.raises(ValueError, match="exactly"):
        load_config(path)
