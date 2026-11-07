# /// script
# requires-python = ">=3.12"
# dependencies = ["xlrd==2.0.2"]
# ///
"""Extract the pinned annual window from Damodaran's public source workbook.

Run explicitly with `uv run scripts/refresh_data.py`; normal model runs stay offline.
Source changes require reviewing both the CSV and provenance diff.
"""

import argparse
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

import xlrd

SOURCE = "https://www.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls"
PAGE = "https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html"
ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, help="use an already downloaded source workbook")
    args = parser.parse_args()
    if args.workbook:
        raw = args.workbook.read_bytes()
    else:
        with urlopen(SOURCE, timeout=45) as response:
            raw = response.read(5_000_001)
        if len(raw) > 5_000_000:
            raise ValueError("unexpected workbook size")
    sheet = xlrd.open_workbook(file_contents=raw).sheet_by_name("Returns by year")
    expected = [
        "Year",
        "S&P 500 (includes dividends)",
        "US Small cap (bottom decile)",
        "3-month T.Bill",
        "US T. Bond (10-year)",
        "Baa Corporate Bond",
    ]
    header = next(i for i in range(sheet.nrows) if sheet.cell_value(i, 0) == "Year")
    if [str(c).strip() for c in sheet.row_values(header)[:6]] != expected:
        raise ValueError("source workbook schema changed; review before updating")
    extracted = []
    for i in range(header + 1, sheet.nrows):
        year = sheet.cell_value(i, 0)
        if isinstance(year, (int, float)) and 1976 <= year <= 2025:
            extracted.append(
                [int(year), *[format(sheet.cell_value(i, c), ".12f") for c in (1, 4, 5, 3)]]
            )
    if [r[0] for r in extracted] != list(range(1976, 2026)):
        raise ValueError("source must contain exactly the ordered 1976-2025 window")
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["year", "us_equity", "treasury_10y", "baa_credit", "cash_3m"])
    writer.writerows(extracted)
    csv_bytes = output.getvalue().encode()
    (ROOT / "data/annual_returns.csv").write_bytes(csv_bytes)
    metadata = {
        "provider": "Aswath Damodaran, NYU Stern",
        "source_url": SOURCE,
        "description_url": PAGE,
        "retrieved_utc": datetime.now(timezone.utc).isoformat(),
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "csv_sha256": hashlib.sha256(csv_bytes).hexdigest(),
        "sheet": "Returns by year",
        "first_year": 1976,
        "last_year": 2025,
        "observations": 50,
        "units": "decimal annual nominal USD returns",
        "source_columns_zero_based": {
            "us_equity": 1,
            "treasury_10y": 4,
            "baa_credit": 5,
            "cash_3m": 3,
        },
    }
    (ROOT / "data/provenance.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("Extracted 50 years, four asset classes; source and CSV SHA-256 recorded.")


if __name__ == "__main__":
    main()
