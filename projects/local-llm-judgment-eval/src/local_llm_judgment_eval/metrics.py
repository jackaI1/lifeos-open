"""Scores against aggregate response frequencies, not fabricated individual labels."""

import math
from itertools import combinations
from statistics import mean


def _validate(p, q):
    if not p or len(p) != len(q):
        raise ValueError("vectors must be nonempty and equal length")
    for vector in (p, q):
        if any(not math.isfinite(x) or x < 0 or x > 1 for x in vector):
            raise ValueError("invalid probability")
        if not math.isclose(sum(vector), 1, abs_tol=1e-6):
            raise ValueError("vector must sum to one")


def distribution_scores(p: list[float], q: list[float]) -> dict[str, float]:
    _validate(p, q)
    midpoint = [(x + y) / 2 for x, y in zip(p, q, strict=True)]

    def kl(vector):
        return sum(x * math.log2(x / m) for x, m in zip(vector, midpoint, strict=True) if x)

    return {
        "brier": 1 + sum(x * x - 2 * x * y for x, y in zip(p, q, strict=True)),
        "excess_brier": sum((x - y) ** 2 for x, y in zip(p, q, strict=True)),
        "total_variation": sum(abs(x - y) for x, y in zip(p, q, strict=True)) / 2,
        "js_divergence_bits": (kl(p) + kl(q)) / 2,
    }


def soft_ece(predictions: list[list[float]], targets: list[list[float]], bins: int = 10) -> float:
    """Equal-width classwise ECE with survey fractions as soft outcomes."""
    if not predictions or len(predictions) != len(targets) or bins < 1:
        raise ValueError("paired observations and positive bin count required")
    classes = len(predictions[0])
    buckets = [[[] for _ in range(bins)] for _ in range(classes)]
    for p, q in zip(predictions, targets, strict=True):
        _validate(p, q)
        if len(p) != classes:
            raise ValueError("all observations must use the same categories")
        for category, (x, y) in enumerate(zip(p, q, strict=True)):
            buckets[category][min(int(x * bins), bins - 1)].append((x, y))
    count = len(predictions) * classes
    return sum(
        abs(sum(x - y for x, y in bucket)) / count for category in buckets for bucket in category
    )


def repeat_consistency(predictions: list[list[float]]) -> float | None:
    """Mean pairwise total variation; zero means identical accepted repeats."""
    if len(predictions) < 2:
        return None
    return mean(
        distribution_scores(a, b)["total_variation"] for a, b in combinations(predictions, 2)
    )
