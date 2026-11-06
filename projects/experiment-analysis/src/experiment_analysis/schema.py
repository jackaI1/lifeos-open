"""Fail closed on unsupported designs instead of silently dropping observations."""

import numpy as np
import pandas as pd

METRICS = ("correct", "automated", "service_seconds")
REQUIRED = ("order_id", "experiment", "location", "period", "arm", "items", *METRICS)


def validate_orders(rows: pd.DataFrame) -> None:
    missing = set(REQUIRED) - set(rows.columns)
    if missing:
        raise ValueError(f"Missing columns: {sorted(missing)}")
    if rows.empty or rows[list(REQUIRED)].isna().any().any():
        raise ValueError("Orders must be nonempty with no missing required values")
    if rows.order_id.duplicated().any():
        raise ValueError("order_id must be globally unique")
    if not rows.experiment.isin(["ab", "did"]).all():
        raise ValueError("experiment must be ab or did")
    for col in ("period", "arm", "items", *METRICS):
        if not pd.api.types.is_numeric_dtype(rows[col]) or not np.isfinite(rows[col]).all():
            raise ValueError(f"{col} must be finite numeric values")
    for col in ("arm", "correct", "automated"):
        if not rows[col].isin([0, 1]).all():
            raise ValueError(f"{col} must be binary (0 or 1)")
    if (rows.service_seconds <= 0).any() or (rows["items"] < 1).any():
        raise ValueError("Service time must be positive; items must be >=1")
    if (rows.period % 1 != 0).any() or (rows["items"] % 1 != 0).any():
        raise ValueError("period and items must be integers")


def select_design(rows: pd.DataFrame, design: str) -> pd.DataFrame:
    validate_orders(rows)
    data = rows.loc[rows.experiment == design].copy()
    if set(data.arm.unique()) != {0, 1}:
        raise ValueError(f"{design} requires both arms")
    return data
