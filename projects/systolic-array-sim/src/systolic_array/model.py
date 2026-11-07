"""Clocked weight-stationary array. No matrix multiplication is used here."""

from dataclasses import dataclass, field
import math

import numpy as np


@dataclass(frozen=True)
class Config:
    rows: int = 8
    cols: int = 8
    tile_m: int = 64
    bandwidth: float = 16.0  # aggregate external bytes per clock

    def __post_init__(self):
        for name in ("rows", "cols", "tile_m"):
            value = getattr(self, name)
            if type(value) is not int or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        if not math.isfinite(self.bandwidth) or self.bandwidth <= 0:
            raise ValueError("bandwidth must be finite and positive")

    @property
    def buffer_bytes(self):
        """Provisioned input + weight + int32 accumulator SRAM, no overlap."""
        return (
            self.tile_m * self.rows
            + self.rows * self.cols
            + 4 * self.tile_m * self.cols
        )


@dataclass
class Stats:
    rows: int
    cols: int
    macs: int = 0
    stream_cycles: int = 0
    weight_cycles: int = 0
    memory_cycles: int = 0
    input_bytes: int = 0
    weight_bytes: int = 0
    output_bytes: int = 0
    activation_hops: int = 0
    psum_hops: int = 0
    accumulator_updates: int = 0

    @property
    def total_cycles(self):
        return self.stream_cycles + self.weight_cycles + self.memory_cycles

    @property
    def dram_bytes(self):
        return self.input_bytes + self.weight_bytes + self.output_bytes

    @property
    def sram_bytes(self):
        # DMA writes and injection/programming reads, read+write partial tile,
        # then read completed int32 outputs for DMA. No spills to DRAM.
        return (
            2 * (self.input_bytes + self.weight_bytes)
            + 8 * self.accumulator_updates
            + self.output_bytes
        )

    @property
    def link_bytes(self):
        return self.activation_hops + 4 * self.psum_hops

    @property
    def utilisation(self):
        capacity = self.total_cycles * self.rows * self.cols
        return self.macs / capacity if capacity else 0.0

    @property
    def stream_utilisation(self):
        capacity = self.stream_cycles * self.rows * self.cols
        return self.macs / capacity if capacity else 0.0


@dataclass(frozen=True)
class Cycle:
    clock: int
    phase: str
    tile: tuple[int, int, int]  # global m, k, n offsets
    # row, col, local m, activation, stationary weight, outgoing int32 psum
    macs: tuple[tuple[int, int, int, int, int, int], ...] = ()
    outputs: tuple[tuple[int, int, int], ...] = ()
    weights: tuple[tuple[int, int, int], ...] = ()


@dataclass
class Result:
    output: np.ndarray
    stats: Stats
    trace: tuple[Cycle, ...] = field(default_factory=tuple)


def wrap32(value):
    """Two's-complement wrap, with int64 intermediates to avoid warnings."""
    return (value + 2**31) % 2**32 - 2**31


def transfer_cycles(size, bandwidth):
    """Integer ceiling for the configured float, without float overflow."""
    numerator, denominator = float(bandwidth).as_integer_ratio()
    return (size * denominator + numerator - 1) // numerator


def quantize(values):
    """Symmetric per-tensor int8 quantisation; nearest-even, zero point 0."""
    values = np.asarray(values, dtype=np.float64)
    if not np.isfinite(values).all():
        raise ValueError("quantization requires finite values")
    peak = float(np.max(np.abs(values))) if values.size else 0.0
    scale = (
        max(peak / 127, float(np.finfo(np.float64).smallest_subnormal)) if peak else 1.0
    )
    return np.clip(np.rint(values / scale), -127, 127).astype(np.int8), scale


def simulate(a, b, config=Config(), *, trace=False, trace_limit=10000):
    """Compute int8 A[M,K] @ B[K,N], clocking neighbour registers each tick.

    Tile order N, M, K retains one output tile through all reduction panels.
    DMA, row-wise weight programming and streaming never overlap. Empty
    dimensions return host-created zeros without scheduling array work.
    """
    a, b = np.asarray(a), np.asarray(b)
    if a.ndim != 2 or b.ndim != 2 or a.shape[1] != b.shape[0]:
        raise ValueError("expected compatible two-dimensional A[M,K], B[K,N]")
    if a.dtype != np.int8 or b.dtype != np.int8:
        raise TypeError("operands must be int8; use quantize for float inputs")
    if trace and (type(trace_limit) is not int or trace_limit <= 0):
        raise ValueError("trace_limit must be a positive integer")
    m, k, n = a.shape[0], a.shape[1], b.shape[1]
    output = np.zeros((m, n), dtype=np.int32)
    stats = Stats(config.rows, config.cols)
    events = []
    clock = 0
    tile = (0, 0, 0)
    event_macs = 0

    def tick(phase, macs=(), outputs=(), weights=()):
        nonlocal clock, event_macs
        if trace:
            event_macs += len(macs)
            if len(events) >= trace_limit or event_macs > 1_000_000:
                raise ValueError("trace exceeds trace_limit or 1,000,000 MAC events")
            events.append(Cycle(clock, phase, tile, macs, outputs, weights))
        clock += 1

    def dma(size):
        nonlocal clock
        clocks = transfer_cycles(size, config.bandwidth)
        stats.memory_cycles += clocks
        if trace:
            for _ in range(clocks):
                tick("memory")
        else:
            clock += clocks

    if not m or not k or not n:
        return Result(output, stats)
    for ni in range(0, n, config.cols):
        nc = min(config.cols, n - ni)
        for mi in range(0, m, config.tile_m):
            mt = min(config.tile_m, m - mi)
            acc = np.zeros((mt, nc), dtype=np.int64)
            for ki in range(0, k, config.rows):
                kh = min(config.rows, k - ki)
                tile = (mi, ki, ni)
                stats.weight_bytes += kh * nc
                stats.input_bytes += mt * kh
                dma(kh * nc)
                weights = np.zeros((kh, nc), dtype=np.int64)
                for r in range(kh):
                    weights[r] = b[ki + r, ni : ni + nc]
                    updates = (
                        tuple((r, c, int(weights[r, c])) for c in range(nc))
                        if trace
                        else ()
                    )
                    tick("weight", weights=updates)
                    stats.weight_cycles += 1
                dma(mt * kh)
                # Each register holds a value and its stream-row tag. -1 is a bubble.
                av = np.zeros((kh, nc), dtype=np.int64)
                at = np.full((kh, nc), -1, dtype=np.int64)
                pv = np.zeros((kh, nc), dtype=np.int64)
                pt = np.full((kh, nc), -1, dtype=np.int64)
                row_ids = np.arange(kh)
                for t in range(mt + kh + nc - 2):
                    # Read only previous-clock registers before replacing state.
                    nav = np.zeros_like(av)
                    nat = np.full_like(at, -1)
                    nav[:, 1:], nat[:, 1:] = av[:, :-1], at[:, :-1]
                    stream_rows = t - row_ids
                    injecting = (stream_rows >= 0) & (stream_rows < mt)
                    rr = row_ids[injecting]
                    nav[rr, 0] = a[mi + stream_rows[injecting], ki + rr]
                    nat[rr, 0] = stream_rows[injecting]
                    npv = np.zeros_like(pv)
                    npt = np.full_like(pt, -1)
                    npv[1:], npt[1:] = pv[:-1], pt[:-1]
                    npt[0] = nat[0]  # top boundary supplies a zero partial sum
                    valid = (nat >= 0) & (nat == npt)
                    npv = np.where(valid, wrap32(npv + nav * weights), 0)
                    npt = np.where(valid, nat, -1)
                    stats.macs += int(np.count_nonzero(valid))
                    stats.activation_hops += int(np.count_nonzero(nat[:, 1:] >= 0))
                    stats.psum_hops += int(np.count_nonzero(pt[:-1] >= 0))
                    emitted = []
                    for c in range(nc):
                        local_m = int(npt[-1, c])
                        if local_m >= 0:
                            value = int(npv[-1, c])
                            acc[local_m, c] = wrap32(acc[local_m, c] + value)
                            stats.accumulator_updates += 1
                            if trace:
                                emitted.append((local_m, c, value))
                    macs = (
                        tuple(
                            (
                                int(r),
                                int(c),
                                int(nat[r, c]),
                                int(nav[r, c]),
                                int(weights[r, c]),
                                int(npv[r, c]),
                            )
                            for r, c in zip(*np.nonzero(valid))
                        )
                        if trace
                        else ()
                    )
                    tick("stream", macs, tuple(emitted))
                    stats.stream_cycles += 1
                    av, at, pv, pt = nav, nat, npv, npt
            output[mi : mi + mt, ni : ni + nc] = acc.astype(np.int32)
            stats.output_bytes += 4 * mt * nc
            dma(4 * mt * nc)
    assert clock == stats.total_cycles
    return Result(output, stats, tuple(events))
