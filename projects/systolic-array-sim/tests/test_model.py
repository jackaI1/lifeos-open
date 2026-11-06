import importlib

import numpy as np
import pytest


def model():
    return importlib.import_module("systolic_array.model")


def test_two_by_two_wavefront_and_programming():
    s = model()
    a = np.array([[1, 2], [3, 4]], dtype=np.int8)
    b = np.array([[5, 6], [7, 8]], dtype=np.int8)
    result = s.simulate(a, b, s.Config(rows=2, cols=2, tile_m=2), trace=True)
    np.testing.assert_array_equal(result.output, [[19, 22], [43, 50]])
    assert result.output.dtype == np.int32
    assert result.stats.macs == 8
    assert result.stats.stream_cycles == 4
    assert result.stats.weight_cycles == 2
    assert result.stats.memory_cycles == 3  # B=4, A=4, C=16 at 16 B/clock
    assert result.stats.total_cycles == 9
    stream = [c for c in result.trace if c.phase == "stream"]
    assert [len(c.macs) for c in stream] == [1, 3, 3, 1]
    # (local m, local n, emitted value). Bottom-right emerges last.
    assert [c.outputs for c in stream] == [
        (),
        ((0, 0, 19),),
        ((1, 0, 43), (0, 1, 22)),
        ((1, 1, 50),),
    ]
    assert [c.clock for c in result.trace] == list(range(9))
    assert result.stats.activation_hops == 4
    assert result.stats.psum_hops == 4


@pytest.mark.parametrize(
    "shape",
    [(1, 1, 1), (7, 9, 5), (2, 17, 3), (13, 2, 19), (0, 3, 4), (3, 0, 4), (3, 4, 0)],
)
@pytest.mark.parametrize("geometry", [(1, 1, 1), (3, 4, 5), (8, 8, 16)])
def test_numpy_oracle_and_ragged_or_empty_tiles(shape, geometry):
    s = model()
    m, k, n = shape
    rng = np.random.default_rng(42)
    a = rng.integers(-128, 128, (m, k), dtype=np.int8)
    b = rng.integers(-128, 128, (k, n), dtype=np.int8)
    original_a, original_b = a.copy(), b.copy()
    result = s.simulate(a, b, s.Config(*geometry))
    np.testing.assert_array_equal(
        result.output, a.astype(np.int32) @ b.astype(np.int32)
    )
    np.testing.assert_array_equal(a, original_a)
    np.testing.assert_array_equal(b, original_b)
    assert result.stats.macs == m * k * n
    assert result.trace == ()
    assert 0 <= result.stats.utilisation <= 1


def test_extreme_values_and_int32_wraparound():
    s = model()
    a = np.full((1, 131073), -128, dtype=np.int8)
    b = np.full((131073, 1), -128, dtype=np.int8)
    result = s.simulate(a, b, s.Config(rows=256, cols=1, tile_m=1))
    assert int(result.output[0, 0]) == -2147467264
    assert result.stats.macs == 131073


@pytest.mark.parametrize(
    "kwargs",
    [
        {"rows": 0},
        {"cols": -1},
        {"tile_m": 1.5},
        {"rows": True},
        {"bandwidth": 0},
        {"bandwidth": float("nan")},
        {"bandwidth": float("inf")},
    ],
)
def test_invalid_configuration(kwargs):
    with pytest.raises((TypeError, ValueError)):
        model().Config(**kwargs)


@pytest.mark.parametrize(
    "a,b",
    [
        (np.ones((2, 3)), np.ones((3, 2))),
        (np.ones(2, dtype=np.int8), np.ones((2, 2), dtype=np.int8)),
        (np.ones((2, 3), dtype=np.int8), np.ones((4, 2), dtype=np.int8)),
    ],
)
def test_reject_invalid_operands(a, b):
    with pytest.raises((TypeError, ValueError)):
        model().simulate(a, b)


def test_symmetric_quantization_and_zero():
    s = model()
    q, scale = s.quantize(np.array([-2.0, 0, 1, 2]))
    assert scale == pytest.approx(2 / 127)
    np.testing.assert_array_equal(q, [-127, 0, 64, 127])
    zero, scale = s.quantize(np.zeros((2, 2)))
    assert scale == 1
    assert not zero.any()
    with pytest.raises(ValueError):
        s.quantize(np.array([np.nan]))


def test_subnormal_quantization_keeps_a_positive_representable_scale():
    smallest = float.fromhex("0x0.0000000000001p-1022")
    with np.errstate(all="raise"):
        q, scale = model().quantize([0, smallest, -smallest])
    assert scale == smallest
    np.testing.assert_array_equal(q, [0, 1, -1])


def test_trace_limit_prevents_unbounded_storage():
    s = model()
    with pytest.raises(ValueError, match="trace"):
        s.simulate(
            np.ones((4, 4), dtype=np.int8),
            np.ones((4, 4), dtype=np.int8),
            trace=True,
            trace_limit=1,
        )
