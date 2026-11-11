import json
import os

import pytest

torch = pytest.importorskip("torch")

from local_llm_judgment_eval.kernel_bench import (  # noqa: E402
    run_kernel_benchmark,
    write_kernel_report,
)
from local_llm_judgment_eval.kernels import (  # noqa: E402
    fused_score,
    reference_score,
    triton_available,
)

# The Triton kernel runs here only in interpreter mode, which needs TRITON_INTERPRET=1 (CI sets it).
INTERPRETED = triton_available() and os.environ.get("TRITON_INTERPRET") == "1"
needs_triton = pytest.mark.skipif(not INTERPRETED, reason="needs Triton interpreter or CUDA")


def _case(batch, choices, scale, seed=0):
    gen = torch.Generator().manual_seed(seed)
    logits = torch.randn(batch, choices, generator=gen) * scale
    targets = torch.softmax(torch.randn(batch, choices, generator=gen), dim=-1)
    return logits, targets


def _assert_close(actual, expected, atol, rtol):
    assert torch.isfinite(actual).all()
    torch.testing.assert_close(actual, expected, atol=atol, rtol=rtol)


def test_reference_matches_manual_softmax_formula():
    logits = torch.tensor([[1.0, 2.0, 3.0, 4.0]])
    targets = torch.tensor([[0.1, 0.2, 0.3, 0.4]])
    probs, score = reference_score(logits, targets, temperature=2.0)
    scaled = logits / 2.0
    expected_probs = torch.exp(scaled) / torch.exp(scaled).sum()
    expected_score = -(targets * torch.log(expected_probs)).sum()
    _assert_close(probs, expected_probs, 1e-6, 1e-6)
    _assert_close(score, expected_score.reshape(1), 1e-6, 1e-6)
    assert torch.allclose(probs.sum(dim=-1), torch.ones(1))


@pytest.mark.parametrize("temperature", [0.5, 1.0, 0.7, 2.0])
def test_cpu_fallback_equals_reference_on_random_inputs(temperature):
    logits, targets = _case(257, 4, scale=3.0)
    ref = reference_score(logits, targets, temperature)
    fallback = fused_score(logits, targets, temperature)
    _assert_close(fallback[0], ref[0], 1e-6, 1e-6)
    _assert_close(fallback[1], ref[1], 1e-6, 1e-6)


@pytest.mark.parametrize(
    ("scale", "temperature", "atol"),
    [
        (1.0, 1.0, 1e-6),
        (1e4, 1.0, 1e-3),  # very large logits: float32 spacing near 1e4 is about 1e-3
        (1e4, 0.5, 1e-3),
        (1e-4, 1.0, 1e-6),  # almost identical logits, near-uniform probabilities
        (1e4, 0.05, 1e-2),  # large logits with a sharp temperature
    ],
)
def test_edge_logit_scales_match_reference(scale, temperature, atol):
    logits, targets = _case(64, 4, scale=scale, seed=3)
    ref_probs, ref_score = reference_score(logits, targets, temperature)
    probs, score = fused_score(logits, targets, temperature)
    _assert_close(probs, ref_probs, atol, 1e-5)
    _assert_close(score, ref_score, atol, 1e-5)


def test_extreme_gap_keeps_zero_probabilities_finite():
    # One choice is 20000 nats above the others: the softmax underflows to exact zeros.
    logits = torch.tensor([[20000.0, 0.0, -20000.0, -20000.0]] * 3)
    targets = torch.tensor([[1.0, 0.0, 0.0, 0.0]] * 3)
    probs, score = fused_score(logits, targets)
    assert torch.equal(probs[:, 1:], torch.zeros(3, 3))
    _assert_close(score, torch.zeros(3), 1e-6, 0)


@pytest.mark.parametrize("choices", [1, 2, 3, 5])
def test_non_power_of_two_choice_counts(choices):
    logits, targets = _case(10, choices, scale=2.0, seed=choices)
    ref_probs, ref_score = reference_score(logits, targets)
    probs, score = fused_score(logits, targets)
    _assert_close(probs, ref_probs, 1e-6, 1e-6)
    _assert_close(score, ref_score, 1e-6, 1e-6)


def test_validation_rejects_bad_shapes_and_temperatures():
    logits, targets = _case(2, 4, scale=1.0)
    with pytest.raises(ValueError):
        fused_score(logits, targets[:1])
    with pytest.raises(ValueError):
        reference_score(logits, targets, temperature=0)


@needs_triton
@pytest.mark.parametrize(("batch", "choices"), [(1, 4), (33, 4), (300, 3), (17, 7), (9, 1)])
def test_triton_kernel_matches_reference(batch, choices):
    logits, targets = _case(batch, choices, scale=5.0, seed=batch)
    ref_probs, ref_score = reference_score(logits, targets, 0.8)
    probs, score = fused_score(logits, targets, 0.8)
    _assert_close(probs, ref_probs, 1e-5, 1e-5)
    _assert_close(score, ref_score, 1e-5, 1e-5)


@needs_triton
@pytest.mark.parametrize(("scale", "atol"), [(1e4, 2e-3), (1e-4, 1e-5)])
def test_triton_kernel_edge_logits(scale, atol):
    logits, targets = _case(40, 4, scale=scale, seed=9)
    ref_probs, ref_score = reference_score(logits, targets, 1.0)
    probs, score = fused_score(logits, targets, 1.0)
    _assert_close(probs, ref_probs, atol, 1e-5)
    _assert_close(score, ref_score, atol, 1e-5)


@needs_triton
def test_triton_kernel_handles_empty_batch():
    logits, targets = _case(0, 4, scale=1.0)
    probs, score = fused_score(logits, targets)
    assert probs.shape == (0, 4) and score.shape == (0,)


def test_benchmark_is_seeded_and_writes_schema(tmp_path):
    first = run_kernel_benchmark(batch_sizes=[8, 32], repeats=2, seed=7)
    second = run_kernel_benchmark(batch_sizes=[8, 32], repeats=2, seed=7)
    assert [r["batch_size"] for r in first["rows"]] == [8, 32]
    assert first["seed"] == second["seed"] == 7
    for row in first["rows"]:
        assert row["reference_ms"] > 0
        assert set(row) >= {"fused_ms", "speedup", "max_abs_diff_probs", "fused_status"}
    write_kernel_report(first, tmp_path)
    saved = json.loads((tmp_path / "kernel_bench.json").read_text())
    assert saved["schema_version"] == 1
    # The default device is CPU, so the fused columns must read n/a and never zero.
    assert "n/a" in (tmp_path / "kernel_bench.md").read_text()


def test_benchmark_rejects_empty_batch_list():
    with pytest.raises(ValueError):
        run_kernel_benchmark(batch_sizes=[])
