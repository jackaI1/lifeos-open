"""One MLflow lifecycle for successful and failed project operations."""

import inspect
from functools import wraps
from pathlib import Path

import mlflow

EXPERIMENT = "fictional-member-extraction"


def tracking(tracking_dir):
    root = Path(tracking_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    mlflow.set_tracking_uri(root.as_uri())
    mlflow.set_experiment(EXPERIMENT)


def tracked(kind):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            arguments = inspect.signature(function).bind(*args, **kwargs)
            arguments.apply_defaults()
            tracking(arguments.arguments["tracking_dir"])
            with mlflow.start_run(run_name=kind):
                mlflow.set_tag("kind", kind)
                mlflow.log_params(
                    {
                        key: value
                        for key, value in arguments.arguments.items()
                        if isinstance(value, (str, int, float, bool)) and key != "tracking_dir"
                    }
                )
                try:
                    return function(*args, **kwargs)
                except Exception as error:
                    mlflow.log_dict(
                        {"type": type(error).__name__, "message": str(error)}, "error.json"
                    )
                    raise

        return wrapped

    return decorate
