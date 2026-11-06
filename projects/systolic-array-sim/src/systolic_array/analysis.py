"""Independent tile formulas, roofline bound and explicit energy proxies."""

from dataclasses import asdict, dataclass
import math

from .model import Config, Stats, transfer_cycles


@dataclass(frozen=True)
class EnergyCosts:
    """Illustrative relative units, not measured joules or a process model."""

    mac: float = 1.0
    dram_byte: float = 200.0
    sram_byte: float = 6.0
    link_byte: float = 1.0

    def __post_init__(self):
        if any(not math.isfinite(v) or v < 0 for v in asdict(self).values()):
            raise ValueError("energy coefficients must be finite and nonnegative")


def analyze(shape, config=Config(), energy=EnergyCosts()):
    """Analyze (M,K,N) without executing the array or allocating operands.

    Roofline is an optimistic bound with perfect overlap. The actual schedule
    adds serialized DMA, weight programming and wavefront fill/drain instead.
    """
    if len(shape) != 3 or any(type(d) is not int or d < 0 for d in shape):
        raise ValueError("shape must contain three nonnegative integers (M,K,N)")
    m, k, n = shape
    stats = Stats(config.rows, config.cols)
    if m and k and n:
        ms = [min(config.tile_m, m - i) for i in range(0, m, config.tile_m)]
        ks = [min(config.rows, k - i) for i in range(0, k, config.rows)]
        ns = [min(config.cols, n - i) for i in range(0, n, config.cols)]
        bm, bk, bn = len(ms), len(ks), len(ns)
        stats.macs = m * k * n
        stats.stream_cycles = bn * bk * m + bm * bn * k + bm * bk * n - 2 * bm * bk * bn
        stats.weight_cycles = bm * bn * k
        stats.input_bytes = m * k * bn
        stats.weight_bytes = k * n * bm
        stats.output_bytes = 4 * m * n
        stats.memory_cycles = (
            bm * sum(transfer_cycles(h * w, config.bandwidth) for h in ks for w in ns)
            + bn * sum(transfer_cycles(t * h, config.bandwidth) for t in ms for h in ks)
            + sum(transfer_cycles(4 * t * w, config.bandwidth) for t in ms for w in ns)
        )
        stats.activation_hops = m * k * (n - bn)
        stats.psum_hops = m * n * (k - bk)
        stats.accumulator_updates = m * n * bk
    ops = 2 * stats.macs  # multiply and add count as two integer operations
    intensity = ops / stats.dram_bytes if stats.dram_bytes else 0.0
    peak = 2 * config.rows * config.cols
    bandwidth_roof = config.bandwidth * intensity
    report = asdict(stats)
    report.update(
        shape=list(shape),
        tile_m=config.tile_m,
        bandwidth_bytes_per_cycle=config.bandwidth,
        buffer_bytes=config.buffer_bytes,
        cycles=stats.total_cycles,
        dram_bytes=stats.dram_bytes,
        sram_bytes=stats.sram_bytes,
        link_bytes=stats.link_bytes,
        utilisation=stats.utilisation,
        stream_utilisation=stats.stream_utilisation,
        activation_reuse=stats.macs / stats.input_bytes if stats.input_bytes else 0.0,
        weight_reuse=stats.macs / stats.weight_bytes if stats.weight_bytes else 0.0,
        ops_per_byte=intensity,
        peak_ops_per_cycle=peak,
        roofline_ops_per_cycle=min(peak, bandwidth_roof),
        roofline_bound="empty"
        if not ops
        else ("memory" if bandwidth_roof < peak else "compute"),
        achieved_ops_per_cycle=ops / stats.total_cycles if stats.total_cycles else 0.0,
        energy_coefficients=asdict(energy),
        energy_proxy=(
            stats.macs * energy.mac
            + stats.dram_bytes * energy.dram_byte
            + stats.sram_bytes * energy.sram_byte
            + stats.link_bytes * energy.link_byte
        ),
    )
    return report
