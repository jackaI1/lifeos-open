"""Strict four-choice probability contract shared by every backend."""

import json
import math
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

Probability = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]


class Prediction(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    A: Probability
    B: Probability
    C: Probability
    D: Probability

    def vector(self) -> list[float]:
        return [self.A, self.B, self.C, self.D]

    @model_validator(mode="after")
    def total_is_one(self):
        if not math.isclose(sum(self.vector()), 1.0, abs_tol=1e-6):
            raise ValueError("probabilities must sum to 1 within 0.000001")
        return self


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate key: {key}")
        result[key] = value
    return result


def parse_prediction(raw: str) -> Prediction:
    # No fence stripping, clipping, coercion, extra text, or silent renormalization.
    parsed = json.loads(raw, object_pairs_hook=_unique_object)
    return Prediction.model_validate(parsed)
