"""SRT cues use source time; exported cues use clip time."""
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


STAMP = r'(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})'
TIMING = re.compile(STAMP + r'\s+-->\s+' + STAMP)


def read_srt(path: Path) -> List[Cue]:
    text = Path(path).read_text(encoding='utf-8-sig').replace('\r\n', '\n').strip()
    if not text:
        return []
    cues = []
    for block in re.split(r'\n\s*\n', text):
        lines = block.splitlines()
        if len(lines) < 3 or not lines[0].isdigit():
            raise ValueError('SRT cues need an index, timing line and caption text')
        match = TIMING.fullmatch(lines[1])
        if not match:
            raise ValueError('SRT timing must use HH:MM:SS,mmm --> HH:MM:SS,mmm')
        numbers = [int(n) for n in match.groups()]
        start = numbers[0] * 3600 + numbers[1] * 60 + numbers[2] + numbers[3] / 1000
        end = numbers[4] * 3600 + numbers[5] * 60 + numbers[6] + numbers[7] / 1000
        if end <= start:
            raise ValueError('SRT cue end must follow its start')
        cues.append(Cue(start, end, '\n'.join(lines[2:])))
    return sorted(cues, key=lambda c: c.start)


def clip_captions(cues: List[Cue], start: float, end: float) -> List[Cue]:
    return [Cue(max(c.start, start) - start, min(c.end, end) - start, c.text)
            for c in cues if c.start < end and c.end > start]


def _stamp(seconds: float) -> str:
    millis = round(seconds * 1000)
    seconds, ms = divmod(millis, 1000)
    minutes, sec = divmod(seconds, 60)
    hours, minute = divmod(minutes, 60)
    return f'{hours:02}:{minute:02}:{sec:02},{ms:03}'


def write_srt(path: Path, cues: List[Cue]) -> None:
    Path(path).write_text('\n\n'.join(f'{i}\n{_stamp(c.start)} --> {_stamp(c.end)}\n{c.text}'
                                   for i, c in enumerate(cues, 1)) + '\n', encoding='utf-8')
