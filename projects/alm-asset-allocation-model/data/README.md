# Annual return snapshot

The model uses Aswath Damodaran's public NYU Stern [Historical Returns on Stocks, Bonds and Bills](https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/histretSP.html) and its [source Excel workbook](https://www.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls). Attribution belongs to the source provider. The code's MIT license does not assert licensing rights over the source dataset.

`annual_returns.csv` contains the 50 complete years 1976-2025, one row per year. It preserves the source workbook's returns to 12 decimal places. All values are nominal annual USD returns expressed as decimals, not percentages. The source workbook, rather than separately rounded HTML tables, is the extraction authority.

| CSV column | Workbook column, `Returns by year` sheet | Interpretation |
|---|---|---|
| `us_equity` | S&P 500 (includes dividends) | Broad US equity total return |
| `treasury_10y` | US T. Bond (10-year) | Ten-year Treasury return including coupon and price change |
| `baa_credit` | Baa Corporate Bond | Source's Baa corporate bond return series |
| `cash_3m` | 3-month T.Bill | Average short-term bill rate, used as an annual cash-return proxy |

The cash column is a rate proxy, not a compounded investable bill index. The Treasury series represents repeated exposure to ten-year bonds; it is not a single bond held to maturity. Baa credit is an aggregate proxy, not a modeled defaultable bond portfolio. The source may revise history, so a future download can differ even for the same years. Neither normal model runs nor CI download market data.

`provenance.json` records the source URL, retrieval time, SHA-256 of the downloaded workbook, SHA-256 of the extracted CSV, source column indices and window. The workbook itself is not bundled. To explicitly refresh:

```sh
uv run scripts/refresh_data.py
# Or extract a downloaded copy:
uv run scripts/refresh_data.py --workbook /path/to/histretSP.xls
uv run pytest -q
uv run alm-model --output examples/output
```

Review the CSV, metadata and example diff together. The extraction script fails if the source headers or the ordered 50-year window change. The model rejects missing or repeated years, non-finite values and returns at or below -100%.
