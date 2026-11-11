import json

import pytest

pytest.importorskip("torch")

from local_llm_judgment_eval.backends import TransformersBackend  # noqa: E402
from local_llm_judgment_eval.cli import main  # noqa: E402
from local_llm_judgment_eval.profiling import (  # noqa: E402
    PROFILE_SCHEMA_VERSION,
    flag_changes,
    run_profile,
    write_profile_report,
)

REVISION = "0" * 40
PROMPTS = [
    "Question: Is the sky blue? Return ONLY one JSON object.",
    "Question: Is grass green? Return ONLY one JSON object.",
    "Question: Is snow cold? Return ONLY one JSON object.",
]
CONFIG_KEYS = {
    "dtype",
    "device",
    "batch_size",
    "batches",
    "prompts",
    "generated_tokens",
    "wall_s",
    "tokens_per_s",
    "prompts_per_s",
    "peak_client_rss_mib",
    "device_peak_mib",
    "top_ops",
    "outputs",
}


@pytest.fixture(scope="module")
def tiny_report(tiny_model_dir):
    def factory(dtype):
        return TransformersBackend(tiny_model_dir, revision=REVISION, dtype=dtype)

    return run_profile(
        factory,
        PROMPTS,
        dtypes=["float32", "bfloat16"],
        batch_sizes=[1, 2],
        seed=7,
    )


def test_report_schema_covers_every_dtype_and_batch_size(tiny_report):
    assert tiny_report["schema_version"] == PROFILE_SCHEMA_VERSION
    assert set(tiny_report) >= {"schema_version", "model", "environment", "config", "configs"}
    assert tiny_report["config"]["baseline"] == "float32 batch 1"
    assert tiny_report["config"]["prompt_count"] == len(PROMPTS)
    assert len(tiny_report["config"]["prompt_sha256"]) == 64
    assert isinstance(tiny_report["flags"], list)
    combos = [(c["dtype"], c["batch_size"]) for c in tiny_report["configs"]]
    assert combos == [
        ("float32", 1),
        ("float32", 2),
        ("bfloat16", 1),
        ("bfloat16", 2),
    ]
    for config in tiny_report["configs"]:
        assert set(config) == CONFIG_KEYS
        assert len(config["outputs"]) == len(PROMPTS)
        assert config["batches"] == -(-len(PROMPTS) // config["batch_size"])
        assert config["wall_s"] > 0
        assert config["generated_tokens"] > 0
        assert config["tokens_per_s"] == pytest.approx(
            config["generated_tokens"] / config["wall_s"]
        )
        assert config["device_peak_mib"] is None  # CPU run: no device allocator
        assert config["top_ops"], "torch.profiler should report operators"
        for op in config["top_ops"]:
            assert set(op) == {"name", "count", "self_cpu_ms", "total_cpu_ms"}


def test_report_records_model_identity_without_prompt_text(tiny_report):
    model = tiny_report["model"]
    assert model["backend"] == "transformers"
    assert model["revision"] == REVISION
    assert model["dtype"] == "float32"  # the baseline dtype; each row records its own
    dumped = json.dumps(tiny_report["config"])
    assert "Is the sky blue" not in dumped


def test_markdown_and_json_are_written(tiny_report, tmp_path):
    write_profile_report(tiny_report, tmp_path)
    saved = json.loads((tmp_path / "profile.json").read_text())
    assert saved["config"]["batch_sizes"] == [1, 2]
    markdown = (tmp_path / "profile.md").read_text()
    assert "## Flags" in markdown
    assert "| float32 | 2 |" in markdown


def _config(dtype, batch, outputs, tps, memory):
    return {
        "dtype": dtype,
        "batch_size": batch,
        "outputs": outputs,
        "tokens_per_s": tps,
        "device_peak_mib": None,
        "peak_client_rss_mib": memory,
    }


def test_flags_report_output_throughput_and_memory_changes():
    configs = [
        _config("float32", 1, ["a", "b"], 100.0, 500.0),
        _config("float32", 4, ["a", "b"], 104.0, 505.0),  # same outputs, within thresholds
        _config("bfloat16", 1, ["a", "x"], 150.0, 300.0),  # output, throughput, memory change
    ]
    flags = flag_changes(configs)
    assert not any("float32 batch 4" in f for f in flags)
    assert any("bfloat16 batch 1: outputs changed for 1 of 2" in f for f in flags)
    assert any("bfloat16 batch 1: tokens/s changed +50%" in f for f in flags)
    assert any("bfloat16 batch 1: peak memory changed -40%" in f for f in flags)


def test_flags_are_empty_for_a_single_configuration():
    assert flag_changes([_config("float32", 1, ["a"], 1.0, 1.0)]) == []


def test_empty_inputs_are_rejected(tiny_model_dir):
    with pytest.raises(ValueError):
        run_profile(lambda d: None, [], dtypes=["float32"], batch_sizes=[1])


def test_generate_timed_reports_first_token_and_token_count(tiny_model_dir):
    backend = TransformersBackend(tiny_model_dir, revision=REVISION, temperature=0)
    text, timing = backend.generate_timed(PROMPTS[0], {}, 1)
    assert isinstance(text, str)
    assert timing["ttft_s"] >= 0
    assert 0 <= timing["completion_tokens"] <= 192
    assert timing["generation_s"] >= 0
    assert backend.generate(PROMPTS[0], {}, 1) == text  # same seed, greedy decoding


def test_concurrent_batches_are_refused_for_transformers(tiny_model_dir):
    from local_llm_judgment_eval.data import load_survey
    from local_llm_judgment_eval.runner import batch_throughput

    backend = TransformersBackend(tiny_model_dir, revision=REVISION)
    with pytest.raises(ValueError, match="one request at a time"):
        batch_throughput(backend, load_survey(), concurrency=2)


def test_cli_profile_writes_report_for_tiny_model(tiny_model_dir, tmp_path, monkeypatch):
    output = tmp_path / "profile"
    argv = [
        "judgment-eval",
        "profile",
        "--model",
        tiny_model_dir,
        "--revision",
        REVISION,
        "--dtypes",
        "float32",
        "--batch-sizes",
        "1",
        "2",
        "--cases",
        "cncexc",
        "health",
        "--output",
        str(output),
    ]
    monkeypatch.setattr("sys.argv", argv)
    assert main() == 0
    report = json.loads((output / "profile.json").read_text())
    assert [c["batch_size"] for c in report["configs"]] == [1, 2]
    assert report["config"]["prompt_count"] == 2
    assert (output / "profile.md").exists()
