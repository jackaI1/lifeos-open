import json

import pytest

pytest.importorskip("mlflow")

from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.tracking import MlflowClient  # noqa: E402

from local_llm_judgment_eval import tracking  # noqa: E402
from local_llm_judgment_eval.data import load_survey  # noqa: E402
from local_llm_judgment_eval.runner import evaluate, write_reports  # noqa: E402

EXPERIMENT = "test-judgment"


class ScriptedBackend:
    server_pid = None

    def __init__(self, name, replies):
        self.replies = iter(replies)
        self.metadata = {
            "backend": "stub",
            "model": name,
            "revision": "b" * 40,
            "device": "cpu",
            "dtype": "float32",
            "temperature": 0.7,
        }

    def generate(self, prompt, schema, seed):
        return next(self.replies)


def _report(name, replies):
    survey = load_survey()
    return evaluate(
        ScriptedBackend(name, replies),
        survey,
        repeats=1,
        max_attempts=1,
        case_ids=["cncexc", "health"],
    )


@pytest.fixture
def store(tmp_path):
    """A local SQLite store with three models: one invalid, one good, one worse."""
    uri = f"sqlite:///{tmp_path / 'mlflow.db'}"
    good = '{"A":0.25,"B":0.25,"C":0.25,"D":0.25}'
    worse = '{"A":1,"B":0,"C":0,"D":0}'
    models = [
        _report("rejects-everything", ["{}", "{}"]),
        _report("good", [good, good]),
        _report("worse", [worse, worse]),
    ]
    results = tmp_path / "results.json"
    write_reports(models, tmp_path / "report")  # also validates the report shape
    results.write_text(json.dumps({"models": models}))
    return {"uri": uri, "results": results, "dir": tmp_path}


def test_log_results_records_params_metrics_and_coverage(store):
    run_ids = tracking.log_results(
        store["results"], experiment=EXPERIMENT, tracking_uri=store["uri"]
    )
    assert len(run_ids) == 3
    client = MlflowClient(tracking_uri=store["uri"])
    run = client.get_run(run_ids[1])
    assert run.data.params["backend"] == "stub"
    assert run.data.params["revision"] == "b" * 40
    assert run.data.params["config.repeats"] == "1"
    assert float(run.data.metrics["typed_output_coverage"]) == 1.0
    assert float(run.data.metrics["accepted_runs"]) == 2.0
    assert "excess_brier" in run.data.metrics
    assert "mean_latency_s" in run.data.metrics
    rejected = client.get_run(run_ids[0])
    assert float(rejected.data.metrics["typed_output_coverage"]) == 0.0
    assert "excess_brier" not in rejected.data.metrics  # no score for rejected runs
    artifacts = {a.path for a in client.list_artifacts(run_ids[1])}
    assert {"model_config.json", "results.json"} <= artifacts


def test_register_best_skips_low_coverage_and_promote_rollback_round_trip(store):
    tracking.log_results(store["results"], experiment=EXPERIMENT, tracking_uri=store["uri"])
    best = tracking.register_best(
        experiment=EXPERIMENT, tracking_uri=store["uri"], min_coverage=0.9
    )
    assert best["version"] == 1 and best["champion"] is True
    assert best["excess_brier"] > 0  # scored against the survey, not against itself
    config = tracking.champion_config(tracking_uri=store["uri"])
    assert config["model"] == "good"
    assert config["backend"] == "stub"

    # A second registration does not move the champion until someone promotes it.
    worse_only = store["dir"] / "worse.json"
    worse = json.loads(store["results"].read_text())["models"][2]
    worse_only.write_text(json.dumps({"models": [worse]}))
    tracking.log_results(worse_only, experiment="second", tracking_uri=store["uri"])
    second = tracking.register_best(experiment="second", tracking_uri=store["uri"], min_coverage=0)
    assert second["version"] == 2 and second["champion"] is False
    assert tracking.champion_status(tracking_uri=store["uri"])["champion"] == 1

    assert tracking.promote(2, tracking_uri=store["uri"]) == {"champion": 2, "previous": 1}
    assert tracking.champion_config(tracking_uri=store["uri"])["model"] == "worse"
    assert tracking.rollback(tracking_uri=store["uri"]) == {"champion": 1, "rolled_back_from": 2}
    assert tracking.champion_config(tracking_uri=store["uri"])["model"] == "good"
    with pytest.raises(ValueError, match="no earlier champion"):
        tracking.rollback(tracking_uri=store["uri"])


def test_promote_rejects_unknown_version(store):
    tracking.log_results(store["results"], experiment=EXPERIMENT, tracking_uri=store["uri"])
    tracking.register_best(experiment=EXPERIMENT, tracking_uri=store["uri"], min_coverage=0.9)
    with pytest.raises(MlflowException):
        tracking.promote(99, tracking_uri=store["uri"])


def test_register_best_refuses_when_no_run_has_enough_coverage(store):
    rejected = json.loads(store["results"].read_text())["models"][:1]
    only_rejected = store["dir"] / "rejected.json"
    only_rejected.write_text(json.dumps({"models": rejected}))
    tracking.log_results(only_rejected, experiment="low-coverage", tracking_uri=store["uri"])
    with pytest.raises(ValueError, match="no run has coverage"):
        tracking.register_best(
            experiment="low-coverage", tracking_uri=store["uri"], min_coverage=0.9
        )


def test_register_best_refuses_unknown_experiment(store):
    with pytest.raises(ValueError, match="no MLflow experiment"):
        tracking.register_best(
            experiment="missing-experiment", tracking_uri=store["uri"], min_coverage=0.9
        )


def test_model_config_has_no_prompts_or_raw_outputs(store):
    report = json.loads(store["results"].read_text())["models"][1]
    config = tracking.model_config(report)
    assert set(config) <= {
        "backend",
        "model",
        "revision",
        "adapter_sha256",
        "device",
        "dtype",
        "temperature",
        "url",
    }
    assert "raw" not in json.dumps(config)
