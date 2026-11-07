"""Bundled, checksum-pinned aggregate survey targets."""

import hashlib
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

SURVEY_PATH = Path(__file__).parent / "datafiles" / "survey.json"
SURVEY_SHA256 = "fce22476e0bca8fa44dae8b4768add2773fb334f06149bcf13b769f698ab14ac"


class Case(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    persona: str
    question: str
    choices: dict[str, str]
    percentages: list[Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]]
    variable: str
    pdf_page: int
    sample_size: Annotated[int, Field(gt=0)]

    @model_validator(mode="after")
    def valid_target(self):
        if set(self.choices) != {"A", "B", "C", "D"} or len(self.percentages) != 4:
            raise ValueError("exactly four choices required")
        if not 98 <= sum(self.percentages) <= 102:
            raise ValueError("percentages must approximate 100")
        return self

    def target(self) -> list[float]:
        total = sum(self.percentages)
        return [p / total for p in self.percentages]


class Survey(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_url: str
    publisher: str
    survey: str
    field_dates: str
    sample_size: int
    provenance: str
    normalization: str
    cases: list[Case] = Field(min_length=1)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({c.id for c in self.cases}) != len(self.cases):
            raise ValueError("case IDs must be unique")
        return self


def load_survey(path: Path = SURVEY_PATH, *, expected_sha256: str = SURVEY_SHA256) -> Survey:
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected_sha256:
        raise ValueError("survey checksum mismatch")
    return Survey.model_validate_json(raw)
