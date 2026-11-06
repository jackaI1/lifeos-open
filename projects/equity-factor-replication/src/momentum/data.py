"""Strict French ZIP parsing and content-addressed snapshot loading."""

import csv
import hashlib
import re
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

import numpy as np
import pandas as pd


def load_snapshot(directory: Path, record: dict, download: bool = False) -> bytes:
    path = directory / record['file']
    if download:
        with urlopen(record['url'], timeout=60) as response:
            raw = response.read(10_000_001)
    else:
        raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != record['sha256']:
        raise ValueError(f"checksum mismatch: {path.name}; use the committed frozen snapshot")
    if download:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
    return raw


def parse_section(raw: bytes, section: str, columns: int) -> pd.DataFrame:
    with ZipFile(BytesIO(raw)) as archive:
        names = [n for n in archive.namelist() if n.lower().endswith('.csv')]
        if len(names) != 1:
            raise ValueError('expected exactly one CSV in source archive')
        lines = archive.read(names[0]).decode('utf-8-sig').splitlines()
    matches = [i for i, line in enumerate(lines) if line.strip() == section]
    if len(matches) != 1:
        raise ValueError(f'expected one monthly section: {section}')
    start = matches[0] + 1
    header = next(csv.reader([lines[start]]))
    labels = [x.strip() for x in header[1:]]
    if len(labels) != columns or len(set(labels)) != columns:
        raise ValueError('unexpected or duplicate portfolio columns')
    dates, values = [], []
    for line in lines[start + 1:]:
        if not line.strip():
            break
        row = next(csv.reader([line]))
        if len(row) != columns + 1 or not re.fullmatch(r'\d{6}', row[0].strip()):
            raise ValueError('malformed monthly row')
        dates.append(pd.Period(row[0].strip(), freq='M'))
        numbers = np.array([float(v) for v in row[1:]])
        if not np.isfinite(numbers).all():
            raise ValueError('non-finite source return')
        values.append(np.where(np.isin(numbers, [-99.99, -999]), np.nan, numbers / 100))
    if not dates:
        raise ValueError('empty monthly section')
    index = pd.PeriodIndex(dates, freq='M', name='month')
    if not index.equals(pd.period_range(index[0], index[-1], freq='M', name='month')):
        raise ValueError('duplicate, unordered or missing calendar month')
    return pd.DataFrame(values, columns=labels, index=index)
