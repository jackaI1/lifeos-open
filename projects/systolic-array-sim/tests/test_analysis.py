import importlib
import json
import subprocess
import sys

import numpy as np
import pytest

from systolic_array.model import Config, simulate


def analysis():
    return importlib.import_module("systolic_array.analysis")


def test_hand_calculated_roofline_reuse_and_energy_counts():
    report = analysis().analyze((2, 2, 2), Config(2, 2, 2))
    assert report["cycles"] == 9
    assert report["stream_cycles"] == 4
    assert report["weight_cycles"] == 2
    assert report["memory_cycles"] == 3
    assert report["dram_bytes"] == 24
    assert report["sram_bytes"] == 64
    assert report["link_bytes"] == 20
    assert report["macs"] == 8
    assert report["ops_per_byte"] == pytest.approx(2 / 3)
    assert report["peak_ops_per_cycle"] == 8
    assert report["roofline_ops_per_cycle"] == 8
    assert report["achieved_ops_per_cycle"] == pytest.approx(16 / 9)
    assert report["utilisation"] == pytest.approx(2 / 9)
    assert report["stream_utilisation"] == 0.5
    assert report["activation_reuse"] == 2
    assert report["weight_reuse"] == 2
    assert report["energy_proxy"] == 8 + 24 * 200 + 64 * 6 + 20
    assert report["buffer_bytes"] == 24


@pytest.mark.parametrize("shape", [(7, 9, 5), (1, 1, 1), (65, 17, 13), (3, 0, 4)])
@pytest.mark.parametrize("config", [Config(3, 4, 5, 1.5), Config(8, 8, 64, 16)])
def test_closed_form_matches_actual_register_execution(shape, config):
    m, k, n = shape
    result = simulate(
        np.ones((m, k), dtype=np.int8), np.ones((k, n), dtype=np.int8), config
    )
    report = analysis().analyze(shape, config)
    for key in (
        "stream_cycles",
        "weight_cycles",
        "memory_cycles",
        "dram_bytes",
        "sram_bytes",
        "macs",
        "link_bytes",
        "utilisation",
    ):
        assert report[key] == getattr(result.stats, key)
    assert report["cycles"] == result.stats.total_cycles
    assert report["achieved_ops_per_cycle"] <= report["roofline_ops_per_cycle"]


def test_bandwidth_and_stream_length_tradeoffs():
    slow = analysis().analyze((64, 32, 32), Config(8, 8, 64, 1))
    fast = analysis().analyze((64, 32, 32), Config(8, 8, 64, 256))
    small = analysis().analyze((64, 32, 32), Config(8, 8, 8, 256))
    assert slow["roofline_bound"] == "memory"
    assert fast["roofline_bound"] == "compute"
    assert slow["cycles"] > fast["cycles"]
    assert fast["weight_reuse"] == 64
    assert small["weight_reuse"] == 8
    assert fast["weight_bytes"] * 8 == small["weight_bytes"]


def test_subnormal_bandwidth_uses_exact_transfer_ceiling():
    config = Config(1, 1, 1, float.fromhex("0x0.0000000000001p-1022"))
    result = simulate(
        np.ones((1, 1), dtype=np.int8), np.ones((1, 1), dtype=np.int8), config
    )
    report = analysis().analyze((1, 1, 1), config)
    # Six bytes transferred; each takes 2**1074 clocks. Plus program and MAC.
    assert report["cycles"] == result.stats.total_cycles == 6 * 2**1074 + 2
    assert int(result.output[0, 0]) == 1


def test_configurable_energy_proxy_changes_only_cost_not_schedule():
    s = analysis()
    report = s.analyze((2, 2, 2), Config(2, 2, 2), s.EnergyCosts(2, 3, 4, 5))
    assert report["energy_proxy"] == 8 * 2 + 24 * 3 + 64 * 4 + 20 * 5
    assert report["cycles"] == 9
    with pytest.raises(ValueError):
        s.EnergyCosts(dram_byte=-1)


@pytest.mark.parametrize("shape", [(-1, 2, 3), (1, 2), (True, 2, 3), (1.2, 2, 3)])
def test_analysis_rejects_invalid_shape(shape):
    with pytest.raises(ValueError):
        analysis().analyze(shape)


def test_convolution_lowering_against_direct_spatial_sum():
    w = importlib.import_module("systolic_array.workloads")
    image = np.arange(1 * 4 * 5 * 2, dtype=np.int8).reshape(1, 4, 5, 2) - 10
    kernels = np.arange(3 * 2 * 2 * 3, dtype=np.int8).reshape(3, 2, 2, 3) - 5
    a, b, output_shape = w.lower_conv2d(image, kernels, stride=2, padding=1)
    actual = simulate(a, b, Config(3, 2, 5)).output.reshape(output_shape)
    padded = np.pad(image, ((0, 0), (1, 1), (1, 1), (0, 0)))
    expected = np.zeros((1, 2, 3, 3), dtype=np.int32)
    for y in range(2):
        for x in range(3):
            for c in range(3):
                patch = padded[0, y * 2 : y * 2 + 3, x * 2 : x * 2 + 2].astype(np.int32)
                expected[0, y, x, c] = np.sum(
                    patch * kernels[:, :, :, c].astype(np.int32)
                )
    np.testing.assert_array_equal(actual, expected)


def test_attention_scores_use_transposed_keys():
    w = importlib.import_module("systolic_array.workloads")
    cases = w.example_workloads(seed=7)
    assert {c.name for c in cases} == {
        "conv3x3",
        "conv1x1",
        "attention-scores",
        "attention-values",
        "decode-scores",
    }
    case = next(c for c in cases if c.name == "attention-scores")
    assert case.a.shape == (64, 32)
    assert case.b.shape == (32, 64)
    np.testing.assert_array_equal(
        simulate(case.a, case.b).output,
        case.a.astype(np.int32) @ case.b.astype(np.int32),
    )
    assert next(c for c in cases if c.name == "attention-values").a.min() >= 0


def test_attention_fixture_under_strict_floating_point_checks():
    w = importlib.import_module("systolic_array.workloads")
    with np.errstate(all="raise"):
        cases = w.example_workloads()
    assert all(c.a.dtype == np.int8 and c.b.dtype == np.int8 for c in cases)


@pytest.mark.parametrize("kwargs", [{"stride": 0}, {"padding": -1}, {"stride": 1.5}])
def test_convolution_rejects_invalid_sampling(kwargs):
    w = importlib.import_module("systolic_array.workloads")
    with pytest.raises(ValueError):
        w.lower_conv2d(
            np.ones((1, 3, 3, 1), dtype=np.int8),
            np.ones((2, 2, 1, 1), dtype=np.int8),
            **kwargs,
        )


def test_convolution_rejects_unusable_shapes_and_dtype():
    w = importlib.import_module("systolic_array.workloads")
    image = np.ones((1, 2, 2, 1), dtype=np.int8)
    with pytest.raises(ValueError):
        w.lower_conv2d(image, np.ones((3, 3, 1, 1), dtype=np.int8))
    with pytest.raises(ValueError):
        w.lower_conv2d(image, np.ones((1, 1, 2, 1), dtype=np.int8))
    with pytest.raises(TypeError):
        w.lower_conv2d(image.astype(float), np.ones((1, 1, 1, 1), dtype=np.int8))


def run_cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "systolic_array", *args],
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_cli_demo_and_json_sweep():
    demo = run_cli("demo", "--trace")
    assert demo.returncode == 0, demo.stderr
    assert "NumPy check: PASS" in demo.stdout
    assert "stream" in demo.stdout
    sweep = run_cli("sweep", "--tiles", "4", "8", "--json", "--verify")
    assert sweep.returncode == 0, sweep.stderr
    reports = json.loads(sweep.stdout)
    assert len(reports) == 10
    assert all(r["numpy_checked"] for r in reports)
    assert {r["tile"] for r in reports} == {4, 8}


def test_cli_custom_matrix_and_invalid_inputs(tmp_path):
    a = np.array([[2, -3, 1]], dtype=np.int8)
    b = np.array([[3], [4], [-5]], dtype=np.int8)
    np.savez(tmp_path / "input.npz", a=a, b=b)
    result = run_cli(
        "matmul",
        str(tmp_path / "input.npz"),
        "--output",
        str(tmp_path / "out.npy"),
        "--tile",
        "2",
    )
    assert result.returncode == 0, result.stderr
    np.testing.assert_array_equal(np.load(tmp_path / "out.npy"), [[-11]])
    for args in [
        ("sweep", "--tiles", "0"),
        ("demo", "--bandwidth", "nan"),
        ("matmul", str(tmp_path / "missing.npz")),
    ]:
        invalid = run_cli(*args)
        assert invalid.returncode != 0
        assert "error:" in invalid.stderr
