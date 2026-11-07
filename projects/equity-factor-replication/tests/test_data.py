import hashlib
from io import BytesIO
from zipfile import ZipFile

import pandas as pd
import pytest

from momentum.data import load_snapshot, parse_section


def archive(text):
    out = BytesIO()
    with ZipFile(out, 'w') as z:
        z.writestr('returns.csv', text)
    return out.getvalue()


def test_monthly_section_units_and_missing_are_not_annual():
    raw = archive('notes\n Value Weight Returns -- Monthly\n,Lo PRIOR,Hi PRIOR\n'
                  '200001,1.00,3.00\n200002,-99.99,-999\n\n'
                  'Value Weight Returns -- Annual\n,Lo PRIOR,Hi PRIOR\n2000,99,99\n')
    df = parse_section(raw, 'Value Weight Returns -- Monthly', 2)
    assert list(df.index) == list(pd.period_range('2000-01', periods=2, freq='M'))
    assert df.iloc[0].tolist() == [0.01, 0.03]
    assert df.iloc[1].isna().all()


@pytest.mark.parametrize('rows', ['200001,1,2\n200001,2,3', '200001,1,2\n200003,2,3',
                                  '200001,nan,2', '200001,inf,2', '200001,1'])
def test_rejects_duplicates_calendar_gaps_and_bad_rows(rows):
    raw = archive('Value Weight Returns -- Monthly\n,A,B\n' + rows + '\n\n')
    with pytest.raises(ValueError):
        parse_section(raw, 'Value Weight Returns -- Monthly', 2)


def test_section_must_exist():
    with pytest.raises(ValueError, match='section'):
        parse_section(archive('wrong section'), 'Value Weight Returns -- Monthly', 2)


def test_snapshot_verifies_hash_before_parsing(tmp_path):
    (tmp_path / 'bad.zip').write_bytes(b'tampered')
    with pytest.raises(ValueError, match='checksum'):
        load_snapshot(tmp_path, {'file': 'bad.zip', 'sha256': hashlib.sha256(b'good').hexdigest()})
