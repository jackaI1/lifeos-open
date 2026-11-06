"""Own server lifetimes, benchmark both exports and link results to training."""

import hashlib
import importlib.metadata
import json
import os
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

import mlflow
from transformers import AutoTokenizer

from llm_eval.benchmark import benchmark
from llm_eval.data import canonical, load_splits, sha256
from llm_eval.model import SYSTEM
from llm_eval.tracking import tracked

CPU_IMAGE = "vllm/vllm-openai-cpu:v0.33.0"
GPU_IMAGE = "vllm/vllm-openai:v0.11.0"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_ready(url, process, timeout=300):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Server exited during startup; inspect server.log")
        try:
            with urllib.request.urlopen(url + "/models", timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise TimeoutError("Server readiness timed out; inspect server.log")


def container_removed(name, timeout=10):
    # Docker's --rm removal can finish just after the attached client exits.
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        check = subprocess.run(
            [
                "docker",
                "container",
                "ls",
                "--all",
                "--filter",
                f"name=^/{name}$",
                "--format",
                "{{.Names}}",
            ],
            capture_output=True,
            timeout=10,
        )
        # Use successful, exact-name inventory rather than locale-dependent error text.
        if check.returncode != 0:
            return False
        if not check.stdout.strip():
            return True
        time.sleep(0.2)
    return False


@contextmanager
def server(model_path, variant, backend, device, output, image=None, startup_timeout=300):
    """Always stop only this process group/container, including readiness failures."""
    if device not in ("cpu", "cuda"):
        raise ValueError("device must be cpu or cuda")
    port = free_port()
    container = None
    path = Path(model_path).resolve()
    if backend == "transformers":
        if device != "cpu":
            raise ValueError("Transformers fallback is CPU only")
        command = [
            sys.executable,
            "-m",
            "llm_eval.fallback_server",
            "--model",
            str(path),
            "--name",
            variant,
            "--port",
            str(port),
        ]
    elif backend == "vllm":
        container = "llm-eval-" + uuid.uuid4().hex[:12]
        selected = image or (
            CPU_IMAGE + ("-arm64" if platform.machine() == "arm64" else "-x86_64")
            if device == "cpu"
            else GPU_IMAGE
        )
        command = [
            "docker",
            "run",
            "--rm",
            "--name",
            container,
            "--label",
            "owner=llm-eval",
            "--log-opt",
            "max-size=10m",
            "--log-opt",
            "max-file=1",
            "--shm-size=1g",
            "-p",
            f"127.0.0.1:{port}:8000",
            "-v",
            f"{path}:/model:ro",
        ]
        if device == "cuda":
            command += ["--gpus", "all"]
        else:
            command += [
                "-e",
                "VLLM_CPU_KVCACHE_SPACE=1",
                "-e",
                "OMP_NUM_THREADS=2",
                "-e",
                "VLLM_CPU_OMP_THREADS_BIND=auto",
            ]
        command += [
            selected,
            "--model",
            "/model",
            "--served-model-name",
            variant,
            "--dtype",
            "float32" if device == "cpu" else "half",
            "--max-model-len",
            "512",
            "--max-num-seqs",
            "4",
            "--enforce-eager",
            "--generation-config",
            "vllm",
            "--no-enable-prefix-caching",
        ]
        if device == "cuda":
            command += ["--gpu-memory-utilization", "0.5"]
    else:
        raise ValueError("backend must be vllm or transformers")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    resource = {
        "owner": "llm-eval serve-compare",
        "port": port,
        "command": command,
        "started_at": datetime.now(UTC).isoformat(),
        "container": container,
    }
    process = None
    with (output / "server.log").open("w") as log:
        try:
            process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
            resource.update(
                pid=process.pid,
                cleanup=(
                    f"docker stop {container}" if container else f"kill -TERM -- -{process.pid}"
                ),
            )
            (output / "resource.json").write_text(json.dumps(resource, indent=2) + "\n")
            url = f"http://127.0.0.1:{port}/v1"
            wait_ready(url, process, startup_timeout)
            yield url, command
        finally:
            resource["cleanup_errors"] = []
            if container:
                try:
                    subprocess.run(
                        ["docker", "stop", "--time", "10", container],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=30,
                    )
                except (OSError, subprocess.TimeoutExpired) as error:
                    resource["cleanup_errors"].append(type(error).__name__)
            if process is not None:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                resource["exit_code"] = process.poll()
            with socket.socket() as sock:
                resource["port_closed"] = sock.connect_ex(("127.0.0.1", port)) != 0
            resource["stopped_at"] = datetime.now(UTC).isoformat()
            if container:
                try:
                    resource["container_removed"] = container_removed(container)
                except (OSError, subprocess.TimeoutExpired) as error:
                    resource["container_removed"] = False
                    resource["cleanup_errors"].append(type(error).__name__)
            (output / "resource.json").write_text(json.dumps(resource, indent=2) + "\n")
            if not resource["port_closed"] or (container and not resource["container_removed"]):
                raise RuntimeError("Server cleanup could not be verified; inspect resource.json")


@tracked("serving-evaluation")
def measure(
    export_dir,
    variant,
    data_dir,
    output_dir,
    backend="transformers",
    device="cpu",
    limit=None,
    max_tokens=96,
    concurrency=1,
    warmup=1,
    tracking_dir="runs/mlruns",
    image=None,
    timeout=120,
):
    if variant not in ("base", "merged") or (limit is not None and limit < 1):
        raise ValueError("Use base/merged and a positive limit")
    if max_tokens < 1 or max_tokens > 512 or concurrency < 1 or warmup < 0 or timeout <= 0:
        raise ValueError("Invalid benchmark budget, concurrency, warmup or timeout")
    root = Path(export_dir)
    manifest = json.loads((root / "export.json").read_text())
    dataset, _ = load_splits(data_dir)
    if sha256(Path(data_dir) / "manifest.json") != manifest["manifest_sha256"]:
        raise ValueError("Serving data differs from training data manifest")
    for name, digest in manifest["weights"][variant].items():
        if sha256(root / variant / name) != digest:
            raise ValueError("Export weight hash mismatch")
    rows = list(dataset["test"])
    if limit is not None:
        rows = rows[:limit]
    output = Path(output_dir)
    if output.exists() and any(output.iterdir()):
        raise ValueError("Benchmark output directory is not empty")
    output.mkdir(parents=True, exist_ok=True)
    tokenizer = AutoTokenizer.from_pretrained(root / variant, local_files_only=True)
    prompts = [
        tokenizer.apply_chat_template(
            [{"role": "system", "content": SYSTEM}, {"role": "user", "content": r["input"]}],
            tokenize=False,
            add_generation_prompt=True,
        )
        for r in rows
    ]
    # Include exact prompts/targets in the cohort hash: different tests cannot look comparable.
    cohort = hashlib.sha256(canonical({"rows": rows, "prompts": prompts}).encode()).hexdigest()
    params = {k: manifest[k] for k in ("model", "revision", "manifest_sha256", "adapter_sha256")}
    params.update(
        variant=variant,
        backend=backend,
        device=device,
        cohort_sha256=cohort,
        max_tokens=max_tokens,
        concurrency=concurrency,
        warmup=warmup,
        timeout=timeout,
        n_test=len(rows),
        seed=42,
        temperature=0,
        source_mode=manifest["source_mode"],
        architecture=platform.machine(),
        operating_system=platform.system(),
        transformers_version=importlib.metadata.version("transformers"),
        torch_version=importlib.metadata.version("torch"),
    )
    # Include the serving image in comparison identity; never compare two engines as equivalent.
    params["image"] = (
        image
        or (
            CPU_IMAGE + ("-arm64" if platform.machine() == "arm64" else "-x86_64")
            if device == "cpu"
            else GPU_IMAGE
        )
        if backend == "vllm"
        else "none"
    )
    params["comparison_key"] = hashlib.sha256(
        canonical({k: v for k, v in params.items() if k != "variant"}).encode()
    ).hexdigest()
    mlflow.log_params(params)
    mlflow.set_tag("training_run_id", manifest["training_run_id"])
    run_id = mlflow.active_run().info.run_id
    try:
        with server(root / variant, variant, backend, device, output, image) as (url, command):
            mlflow.log_dict({"command": command}, "server-command.json")
            metrics, records = benchmark(
                url, variant, rows, prompts, max_tokens, concurrency, warmup, timeout
            )
            report = {
                "run_id": run_id,
                "params": params,
                "metrics": metrics,
                "training_run_id": manifest["training_run_id"],
            }
            (output / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
            (output / "requests.jsonl").write_text("".join(canonical(r) + "\n" for r in records))
            mlflow.log_metrics(metrics)
            if metrics["failed_requests"]:
                raise RuntimeError(f"{metrics['failed_requests']} benchmark requests failed")
        return report
    finally:
        mlflow.log_artifacts(str(output), "serving")
