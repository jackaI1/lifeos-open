import json
import subprocess
import sys

import mlflow
import pytest
from mlflow import MlflowClient

from llm_eval.model import Config
from llm_eval.report import comparison_report
from llm_eval.tracking import EXPERIMENT, tracked, tracking


def test_failed_operations_are_recorded(tmp_path):
    from llm_eval.train import train

    with pytest.raises(ValueError):
        train(Config(steps=0), tmp_path / "data", tmp_path / "output", tmp_path / "tracking")
    client = MlflowClient()
    runs = client.search_runs([client.get_experiment_by_name(EXPERIMENT).experiment_id])
    assert len(runs) == 1
    assert runs[0].info.status == "FAILED"
    assert runs[0].data.params["steps"] == "0"
    assert client.list_artifacts(runs[0].info.run_id)[0].path == "error.json"


def test_report_queries_real_mlflow_and_separates_cohorts(tmp_path):
    root = tmp_path / "tracking"
    tracking(root)
    for variant, cohort in [("base", "same"), ("merged", "same"), ("base", "different")]:
        with mlflow.start_run():
            mlflow.set_tag("kind", "serving-evaluation")
            mlflow.log_params(
                {
                    "variant": variant,
                    "comparison_key": cohort,
                    "backend": "vllm",
                    "device": "cpu",
                    "model": "test",
                    "n_test": 2,
                    "concurrency": 1,
                    "max_tokens": 8,
                }
            )
            mlflow.log_metrics(
                {
                    k: 1
                    for k in (
                        "exact_match",
                        "field_f1",
                        "output_tokens_per_s",
                        "latency_p50_s",
                        "latency_p95_s",
                    )
                }
            )

    @tracked("serving-evaluation")
    def fail(tracking_dir):
        raise RuntimeError("failed generation")

    with pytest.raises(RuntimeError):
        fail(root)
    report = comparison_report(tmp_path / "report", root)
    assert report["runs"] == 4
    assert report["serving_cohorts"] == 2
    text = (tmp_path / "report/comparison.md").read_text()
    assert text.count("Incomplete pair") == 1
    assert len(json.loads((tmp_path / "report/runs.json").read_text())) == 4
    assert "FAILED" in (tmp_path / "report/runs.csv").read_text()


def test_readiness_failure_stops_owned_process(tmp_path, monkeypatch):
    from llm_eval import serving

    original = subprocess.Popen
    owned = []

    def launch(*args, **kwargs):
        process = original([sys.executable, "-c", "import time; time.sleep(600)"], **kwargs)
        owned.append(process)
        return process

    def fail(*args, **kwargs):
        raise TimeoutError("forced startup failure")

    monkeypatch.setattr(serving.subprocess, "Popen", launch)
    monkeypatch.setattr(serving, "wait_ready", fail)
    with pytest.raises(TimeoutError, match="forced startup"):
        with serving.server(tmp_path, "base", "transformers", "cpu", tmp_path):
            pytest.fail("Unready server yielded")
    assert owned[0].poll() is not None
    resource = json.loads((tmp_path / "resource.json").read_text())
    assert resource["port_closed"]
    assert resource["exit_code"] is not None


def test_docker_stop_timeout_still_reaps_owned_client(tmp_path, monkeypatch):
    from llm_eval import serving

    original = subprocess.Popen
    owned = []

    def launch(*args, **kwargs):
        process = original([sys.executable, "-c", "import time; time.sleep(600)"], **kwargs)
        owned.append(process)
        return process

    def docker(command, **kwargs):
        if command[1] == "stop":
            raise subprocess.TimeoutExpired(command, 30)
        return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

    def fail(*args, **kwargs):
        raise TimeoutError("forced startup failure")

    monkeypatch.setattr(serving.subprocess, "Popen", launch)
    monkeypatch.setattr(serving.subprocess, "run", docker)
    monkeypatch.setattr(serving, "wait_ready", fail)
    with pytest.raises(TimeoutError, match="forced startup"):
        with serving.server(tmp_path, "base", "vllm", "cpu", tmp_path):
            pytest.fail("Unready server yielded")
    assert owned[0].poll() is not None
    resource = json.loads((tmp_path / "resource.json").read_text())
    assert resource["port_closed"] and resource["container_removed"]
    assert resource["cleanup_errors"] == ["TimeoutExpired"]


def test_container_removal_waits_for_docker_auto_remove(monkeypatch):
    from llm_eval import serving

    responses = iter(
        [
            subprocess.CompletedProcess([], 0, stdout=b"owned-id", stderr=b""),
            subprocess.CompletedProcess([], 0, stdout=b"", stderr=b""),
        ]
    )
    monkeypatch.setattr(serving.subprocess, "run", lambda *a, **k: next(responses))
    monkeypatch.setattr(serving.time, "sleep", lambda delay: None)
    assert serving.container_removed("owned-container")


def test_docker_access_error_is_not_proof_of_removal(monkeypatch):
    from llm_eval import serving

    monkeypatch.setattr(
        serving.subprocess,
        "run",
        lambda *a, **k: subprocess.CompletedProcess([], 1, stdout=b"", stderr=b"permission denied"),
    )
    assert not serving.container_removed("owned-container")
