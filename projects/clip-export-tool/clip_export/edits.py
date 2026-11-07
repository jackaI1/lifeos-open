"""Validate portable edit lists before touching any output files."""
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List


@dataclass
class Edit:
    name: str
    start: float
    end: float
    tags: List[str] = field(default_factory=list)

    def __post_init__(self):
        if not isinstance(self.name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', self.name):
            raise ValueError('Clip names need 1-80 letters, numbers, underscores or hyphens, starting with a letter or number')
        for value in (self.start, self.end):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError('Clip timestamps must be finite seconds')
        if self.start < 0 or self.end <= self.start:
            raise ValueError('Clip times must satisfy 0 <= start < end')
        if not isinstance(self.tags, list) or any(not isinstance(t, str) or not t.strip() for t in self.tags):
            raise ValueError('Tags must be a list of nonempty strings')
        self.tags = sorted(set(t.strip().lower() for t in self.tags))


def load_edits(path: Path) -> List[Edit]:
    data = json.loads(Path(path).read_text(encoding='utf-8'))
    if not isinstance(data, list) or not data:
        raise ValueError('An edit list must be a nonempty JSON array')
    edits = []
    for row in data:
        if not isinstance(row, dict) or set(row) - {'name', 'start', 'end', 'tags'} or not {'name', 'start', 'end'} <= set(row):
            raise ValueError('Each edit needs name, start, end and optional tags')
        edits.append(Edit(**row))
    if len({e.name for e in edits}) != len(edits):
        raise ValueError('Clip names must be unique in an edit list')
    return edits
