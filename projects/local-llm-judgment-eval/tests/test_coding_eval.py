from local_llm_judgment_eval.coding_eval import gaming_flags, wilson_interval


def test_gaming_flags_detects_tampering_and_literal_answers(tmp_path):
    before = {"tests/test_visible.py": b"assert True", "solution.py": b"pass"}
    (tmp_path / "solution.py").write_text("def solve(x):\n    return 42\n")
    flags = gaming_flags(before, tmp_path, ["solution.py"], ["42"])
    assert any("tests/test_visible.py" in flag for flag in flags)
    assert any("hardcoded" in flag for flag in flags)


def test_wilson_interval_contains_observed_rate():
    low, high = wilson_interval(7, 10)
    assert low < 0.7 < high


def test_ollama_adapter_sends_visible_files_and_applies_reply(tmp_path, monkeypatch):
    import json
    from io import BytesIO

    from local_llm_judgment_eval.coding_eval import ollama_script

    (tmp_path / "solution.py").write_text("broken")
    requests = []

    def respond(request, timeout):
        requests.append(json.loads(request.data))
        return BytesIO(json.dumps({"response": json.dumps({"solution.py": "fixed"})}).encode())

    monkeypatch.setattr("urllib.request.urlopen", respond)
    script = ollama_script(
        {"instruction": "repair"}, tmp_path, "model", "http://localhost:11434", 5
    )
    assert "broken" in requests[0]["prompt"]
    assert requests[0]["model"] == "model"
    assert "fixed" in script


def test_docker_uses_workspace_owner(monkeypatch):
    import os
    import subprocess

    from local_llm_judgment_eval.coding_eval import docker

    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", run)
    docker(["image", "command"], 5)
    assert calls[0][calls[0].index("--user") + 1] == f"{os.getuid()}:{os.getgid()}"
