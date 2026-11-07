"""Strict JSON extraction scores and paired, row-bootstrap uncertainty."""

import json

import numpy as np

from llm_eval.data import FIELDS


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def parse_prediction(text):
    try:
        value = json.loads(text.strip(), object_pairs_hook=unique_object)
    except (ValueError, TypeError):
        return None
    if not isinstance(value, dict) or set(value) != set(FIELDS):
        return None
    if any(v is not None and not isinstance(v, str) for v in value.values()):
        return None
    return value


def score_row(prediction, target):
    parsed = parse_prediction(prediction)
    # Invalid JSON gets no credit. A schema-valid null is an explicit field value.
    correct = sum(parsed[k] == target[k] for k in FIELDS) if parsed is not None else 0
    return {
        "exact_match": float(parsed == target),
        "field_f1": correct / len(FIELDS),
        "valid_json": float(parsed is not None),
        **{f"field_{k}": float(parsed is not None and parsed[k] == target[k]) for k in FIELDS},
    }


def bootstrap(values, samples=2000, seed=42):
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or len(values) == 0 or samples < 1:
        raise ValueError("Bootstrap requires a nonempty vector and positive sample count")
    rng = np.random.default_rng(seed)
    # Bound temporary memory even for large evaluation sets.
    means = [values[rng.integers(0, len(values), len(values))].mean() for _ in range(samples)]
    low, high = np.quantile(means, (0.025, 0.975))
    return {"mean": float(values.mean()), "ci95": [float(low), float(high)]}


def summarize(rows, samples=2000, seed=42):
    if not rows:
        raise ValueError("Cannot score an empty evaluation")
    return {key: bootstrap([r[key] for r in rows], samples, seed) for key in rows[0]}


def paired_delta(base, adapter, samples=2000, seed=42):
    if len(base) != len(adapter) or not base:
        raise ValueError("Paired comparison requires the same nonempty rows in the same order")
    return {
        k: bootstrap([a[k] - b[k] for b, a in zip(base, adapter, strict=True)], samples, seed)
        for k in ("exact_match", "field_f1")
    }
