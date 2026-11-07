import json
import subprocess
import sys


def invoke(*args):
    return subprocess.run(
        [sys.executable, "-m", "local_llm_judgment_eval", *map(str, args)],
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_offline_cli_creates_real_scores_and_comparison(tmp_path):
    out = tmp_path / "baseline"
    result = invoke("baseline", "--output", out)
    assert result.returncode == 0, result.stderr
    report = json.loads((out / "results.json").read_text())["models"][0]
    assert report["summary"]["accepted"] == 27
    assert report["summary"]["brier"] == 0.75
    assert report["summary"]["soft_ece"] > 0
    compared = tmp_path / "comparison"
    result = invoke("compare", out / "results.json", "--output", compared)
    assert result.returncode == 0, result.stderr
    assert (compared / "comparison.md").is_file()


def test_comparison_refuses_mismatched_experiments(tmp_path):
    out = tmp_path / "baseline"
    assert invoke("baseline", "--output", out).returncode == 0
    path = out / "results.json"
    original = json.loads(path.read_text())
    original["models"][0]["config"]["seed"] = 43
    changed = tmp_path / "changed.json"
    changed.write_text(json.dumps(original))
    result = invoke("compare", path, changed, "--output", tmp_path / "compared")
    assert result.returncode == 1
    assert "same survey" in result.stderr


def test_verify_data_offline():
    result = invoke("verify-data")
    assert result.returncode == 0
    assert "9 survey cases verified" in result.stdout


def test_reference_can_match_a_real_experiments_repeat_and_retry_budget(tmp_path):
    result = invoke(
        "baseline", "--repeats", 2, "--max-attempts", 2, "--cases", "cncexc", "--output", tmp_path
    )
    assert result.returncode == 0, result.stderr
    report = json.loads((tmp_path / "results.json").read_text())["models"][0]
    assert report["summary"]["planned"] == 2
    assert report["config"]["max_attempts"] == 2
