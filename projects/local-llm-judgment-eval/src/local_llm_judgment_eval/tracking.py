"""MLflow tracking for evaluation runs, a model registry, and promote/rollback.

Each model in a results.json becomes one MLflow run with its settings as parameters and its
scores, latency, throughput and typed-output coverage as metrics. ``register_best`` puts the best
configuration into the registry and points the ``champion`` alias at it. The local judgment
feature reads the champion with ``champion_config``, so promoting or rolling back a version
changes which model the feature uses without a code change.

MLflow's file-based tracking store is in maintenance mode, so this uses SQLite, a single local
database file, for tracking and the registry. Artifacts go to ./mlruns next to it.
"""

import json
import os
from pathlib import Path

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import mlflow  # noqa: E402
from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.tracking import MlflowClient  # noqa: E402

REGISTERED_MODEL = "local-judgment-model"
CHAMPION_ALIAS = "champion"
HISTORY_TAG = "champion_history"
CONFIG_ARTIFACT = "model_config.json"
DEFAULT_TRACKING_URI = "sqlite:///mlflow.db"
PARAM_KEYS = (
    "backend",
    "model",
    "revision",
    "adapter_sha256",
    "device",
    "dtype",
    "temperature",
    "url",
    "survey_sha256",
)
METRIC_KEYS = (
    "brier",
    "excess_brier",
    "soft_ece",
    "total_variation",
    "js_divergence_bits",
    "repeat_tv",
    "mean_latency_s",
    "mean_ttft_s",
    "tokens_per_s",
    "peak_client_rss_mib",
)


def tracking_uri_from_env() -> str:
    return os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI)


def _client(tracking_uri: str) -> MlflowClient:
    mlflow.set_tracking_uri(tracking_uri)
    return MlflowClient(tracking_uri=tracking_uri)


def model_config(report: dict) -> dict:
    """The settings a feature needs to rebuild this backend. Never includes prompts or outputs."""
    model = report["model"]
    keys = ("backend", "model", "revision", "adapter_sha256", "device", "dtype", "temperature")
    config = {key: model.get(key) for key in keys}
    if model.get("url"):
        config["url"] = model["url"]
    return config


def _run_metrics(report: dict) -> dict[str, float]:
    summary = report["summary"]
    metrics = {key: float(summary[key]) for key in METRIC_KEYS if summary.get(key) is not None}
    metrics["typed_output_coverage"] = float(summary["coverage"])
    metrics["accepted_runs"] = float(summary["accepted"])
    metrics["planned_runs"] = float(summary["planned"])
    throughput = report.get("throughput")
    if throughput:
        metrics["batch_requests_per_s"] = float(throughput["requests_per_s"])
        metrics["batch_tokens_per_s"] = float(throughput["tokens_per_s"])
    return metrics


def log_results(results_path: Path, *, experiment: str, tracking_uri: str) -> list[str]:
    """Log each model in a results.json as one MLflow run. Returns the run IDs."""
    _client(tracking_uri)
    data = json.loads(results_path.read_text())
    mlflow.set_experiment(experiment)
    run_ids = []
    for report in data["models"]:
        with mlflow.start_run(run_name=report["model"].get("model", "model")) as run:
            params = {key: report["model"].get(key) for key in PARAM_KEYS}
            params["survey_sha256"] = report["survey_sha256"]
            params.update(
                {f"config.{k}": v for k, v in report["config"].items() if k != "case_ids"}
            )
            params["config.cases"] = len(report["config"]["case_ids"])
            mlflow.log_params({k: str(v)[:500] for k, v in params.items() if v is not None})
            mlflow.log_metrics(_run_metrics(report))
            mlflow.log_dict(model_config(report), CONFIG_ARTIFACT)
            mlflow.log_artifact(str(results_path))
            run_ids.append(run.info.run_id)
    return run_ids


def _ensure_model(client: MlflowClient, name: str) -> None:
    try:
        client.create_registered_model(name)
    except MlflowException as exc:
        if "already exists" not in str(exc).lower():
            raise


def register_best(
    *,
    experiment: str,
    tracking_uri: str,
    metric: str = "excess_brier",
    min_coverage: float = 0.9,
    name: str = REGISTERED_MODEL,
) -> dict:
    """Register the logged run with the lowest ``metric`` among runs at or above min_coverage."""
    client = _client(tracking_uri)
    found = client.get_experiment_by_name(experiment)
    if found is None:
        raise ValueError(f"no MLflow experiment named {experiment}")
    runs = client.search_runs([found.experiment_id], max_results=5000)
    eligible = [
        r
        for r in runs
        if metric in r.data.metrics
        and r.data.metrics.get("typed_output_coverage", 0) >= min_coverage
    ]
    if not eligible:
        raise ValueError(f"no run has coverage >= {min_coverage} and a {metric} metric")
    best = min(eligible, key=lambda r: r.data.metrics[metric])
    _ensure_model(client, name)
    version = client.create_model_version(
        name=name,
        source=f"runs:/{best.info.run_id}/{CONFIG_ARTIFACT}",
        run_id=best.info.run_id,
        tags={metric: f"{best.data.metrics[metric]:.6f}"},
    )
    # Registering never changes what the feature uses; only the first version becomes champion.
    first = _champion_version(client, name) is None
    if first:
        client.set_registered_model_alias(name, CHAMPION_ALIAS, version.version)
    return {
        "name": name,
        "version": int(version.version),
        "champion": first,
        "run_id": best.info.run_id,
        metric: best.data.metrics[metric],
    }


def _champion_version(client: MlflowClient, name: str) -> int | None:
    try:
        return int(client.get_model_version_by_alias(name, CHAMPION_ALIAS).version)
    except MlflowException:
        return None


def _history(client: MlflowClient, name: str) -> list[int]:
    tags = client.get_registered_model(name).tags
    return json.loads(tags.get(HISTORY_TAG, "[]"))


def _set_champion(client: MlflowClient, name: str, version: int, history: list[int]) -> None:
    client.set_registered_model_alias(name, CHAMPION_ALIAS, str(version))
    client.set_registered_model_tag(name, HISTORY_TAG, json.dumps(history))


def promote(version: int, *, tracking_uri: str, name: str = REGISTERED_MODEL) -> dict:
    """Make ``version`` the champion. The previous champion is kept for rollback."""
    client = _client(tracking_uri)
    client.get_model_version(name, str(version))  # fails clearly if the version is missing
    previous = _champion_version(client, name)
    history = _history(client, name)
    if previous is not None and previous != version:
        history.append(previous)
    _set_champion(client, name, version, history)
    return {"champion": version, "previous": previous}


def rollback(*, tracking_uri: str, name: str = REGISTERED_MODEL) -> dict:
    """Return the champion to the version that was active before the last promotion."""
    client = _client(tracking_uri)
    history = _history(client, name)
    if not history:
        raise ValueError("no earlier champion to roll back to")
    previous_champion = _champion_version(client, name)
    target = history.pop()
    _set_champion(client, name, target, history)
    return {"champion": target, "rolled_back_from": previous_champion}


def champion_config(*, tracking_uri: str, name: str = REGISTERED_MODEL) -> dict:
    """Settings of the registered champion, read from the artifact logged with its run."""
    client = _client(tracking_uri)
    version = client.get_model_version_by_alias(name, CHAMPION_ALIAS)
    path = client.download_artifacts(version.run_id, CONFIG_ARTIFACT)
    return {"version": int(version.version), **json.loads(Path(path).read_text())}


def champion_status(*, tracking_uri: str, name: str = REGISTERED_MODEL) -> dict:
    client = _client(tracking_uri)
    return {
        "champion": _champion_version(client, name),
        "history": _history(client, name),
    }
