# equity-factor-replication

I built a repeatable test of stock momentum to learn how the underlying idea works. This is a learning project.

## Reproduce or inspect the calculations

```sh
uv run momentum --check             # Verify the saved report and numerical artifacts
uv run momentum --output /tmp/momentum-report
uv run pytest -q                   # Run the full test suite
uv run ruff check .                 # Check Python code
```

- [Report](reports/report.md): interpretation, figures, weakening evidence and limitations.
- [All comparisons](reports/results.csv): means, uncertainty, costs, periods and both p-values. A p-value measures evidence against a nonpositive mean under the model.
- [Monthly spreads](reports/monthly_returns.csv): the five gross return series behind the analysis.
- [Result metadata](reports/results.json): the same tests with source hashes.
- [Public data notes](data/README.md): original URLs, frozen vintage, checksums and refresh limitations.

A basis point is 0.01%. The report's annual mean is twelve times the average monthly spread. Its Sharpe ratio compares that average with how much returns vary. Neither is a promise of a fund return: the model assumes a fixed dollar on each side, and omits borrowing fees, financing and market impact. [The protocol](docs/protocol.md) explains the formulas and all fixed choices.

## Tests and limits

There are 3 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `equity-factor-replication-research.yml`.

Generated output omitted: reports/ (generated output).
