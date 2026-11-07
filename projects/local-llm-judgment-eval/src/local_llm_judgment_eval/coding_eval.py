"""Run repository repair experiments with isolated Docker workers."""

import argparse
import html
import json
import math
import os
import shutil
import subprocess
import tempfile
import urllib.request
import uuid
from pathlib import Path

IMAGE = "python:3.12.8-slim@sha256:2199a62885a12290dc9c5be3ca0681d367576ab7bf037da120e564723292a2f0"
ROOT = Path(__file__).resolve().parents[2]


def snapshot(root):
    return {
        str(p.relative_to(root)): p.read_bytes()
        for p in root.rglob("*")
        if p.is_file() and not p.is_symlink()
    }


def gaming_flags(before, root, allowed, forbidden_literals):
    after = snapshot(root)
    flags = []
    for path in sorted(before.keys() | after.keys()):
        if before.get(path) != after.get(path) and path not in allowed:
            flags.append(f"changed or deleted outside allowed paths: {path}")
    for path in allowed:
        content = after.get(path, b"").decode("utf-8", errors="replace")
        if any(literal in content for literal in forbidden_literals):
            flags.append(f"hardcoded expected output in {path}")
    for p in root.rglob("*"):
        if p.is_symlink():
            flags.append(f"symlink in workspace: {p.relative_to(root)}")
    return flags


def wilson_interval(successes, total):
    if not total:
        return (0.0, 0.0)
    z = 1.959963984540054
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return (max(0, center - margin), min(1, center + margin))


def docker(args, timeout):
    name = "coding-eval-" + uuid.uuid4().hex
    command = [
        "docker",
        "run",
        "--name",
        name,
        "--rm",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "--network",
        "none",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--pids-limit",
        "128",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
    ] + args
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
        return result.returncode, (result.stdout + result.stderr)[-8000:]
    except subprocess.TimeoutExpired:
        return 124, "timed out"
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True, timeout=15, check=False)


def ollama_script(task, repo, model, url, timeout):
    files = {p: content.decode() for p, content in snapshot(repo).items()}
    prompt = (
        'Repair the repository task. Return only JSON with a single key "solution.py" '
        "containing the complete Python file.\n"
        + task["instruction"]
        + "\nFiles:\n"
        + json.dumps(files)
    )
    payload = json.dumps(
        {"model": model, "prompt": prompt, "stream": False, "format": "json"}
    ).encode()
    req = urllib.request.Request(
        url.rstrip("/") + "/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        proposal = json.loads(json.load(response)["response"])
    if set(proposal) != {"solution.py"} or not isinstance(proposal["solution.py"], str):
        raise ValueError("Ollama must return exactly one solution.py string")
    return (
        'from pathlib import Path\nPath("/work/solution.py").write_text('
        + repr(proposal["solution.py"])
        + ")\n"
    )


def run_one(task_dir, agent, model, url, timeout):
    task = json.loads((task_dir / "task.json").read_text())
    with tempfile.TemporaryDirectory(prefix="coding-eval-") as temp:
        base = Path(temp)
        work = base / "work"
        shutil.copytree(task_dir / "repo", work)
        before = snapshot(work)
        script = base / "agent.py"
        if agent == "ollama":
            script.write_text(ollama_script(task, work, model, url, timeout))
        else:
            shutil.copyfile(ROOT / "coding_agents" / f"{agent}.py", script)
        code, agent_log = docker(
            [
                "-v",
                f"{work}:/work:rw",
                "-v",
                f"{script}:/agent.py:ro",
                "-w",
                "/work",
                IMAGE,
                "python",
                "/agent.py",
            ],
            timeout,
        )
        flags = gaming_flags(before, work, task["allowed_paths"], task["forbidden_literals"])
        # Hidden tests enter only the independent scoring container, after the agent exits.
        score, score_log = docker(
            [
                "-v",
                f"{work}:/work:ro",
                "-v",
                f"{task_dir / 'hidden'}:/hidden:ro",
                "-w",
                "/work",
                "-e",
                "PYTHONDONTWRITEBYTECODE=1",
                "-e",
                "PYTHONPATH=/work",
                IMAGE,
                "sh",
                "-c",
                "python -m unittest discover -s tests -v && "
                "python -m unittest discover -s /hidden -v",
            ],
            timeout,
        )
        return {
            "task": task["id"],
            "agent": agent,
            "agent_exit": code,
            "hidden_exit": score,
            "flags": flags,
            "passed": code == 0 and score == 0 and not flags,
            "agent_log": agent_log,
            "score_log": score_log,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--agent", choices=["honest", "cheat", "ollama"], default="honest")
    parser.add_argument("--model", default="qwen2.5-coder:7b")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434")
    parser.add_argument("--task", type=Path, default=ROOT / "coding_tasks" / "normalize")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--output", type=Path, default=Path("artifacts/coding-eval"))
    args = parser.parse_args()
    if args.repeats < 1 or args.timeout < 1:
        parser.error("repeats and timeout must be positive")
    results = [
        run_one(args.task.resolve(), args.agent, args.model, args.ollama_url, args.timeout)
        for _ in range(args.repeats)
    ]
    successes = sum(r["passed"] for r in results)
    report = {
        "runs": results,
        "passes": successes,
        "total": len(results),
        "pass_rate": successes / len(results),
        "wilson_95_interval": wilson_interval(successes, len(results)),
        "image": IMAGE,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "results.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "summary.html").write_text(
        '<!doctype html><meta charset="utf-8"><title>Coding evaluation</title>'
        "<h1>Coding evaluation</h1><p>Passes: "
        + f"{successes}/{len(results)}"
        + "</p><pre>"
        + html.escape(json.dumps(report, indent=2))
        + "</pre>"
    )
    print(f"{successes}/{len(results)} passed; report: {args.output}")


if __name__ == "__main__":
    main()
