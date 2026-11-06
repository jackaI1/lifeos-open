import argparse
from pathlib import Path
import pandas as pd
from .harness import backtest, synthetic_data


def main():
    parser = argparse.ArgumentParser(description='Backtest one-hour-ahead production forecasts')
    parser.add_argument('--input', help='CSV with timestamp and production columns; defaults to synthetic data')
    parser.add_argument('--output', default='results', help='directory for fold and forecast CSVs')
    args = parser.parse_args()
    data = pd.read_csv(args.input) if args.input else synthetic_data()
    report, predictions, accepted = backtest(data)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    report.to_csv(output / 'folds.csv', index=False)
    predictions.to_csv(output / 'predictions.csv', index=False)
    print(report.to_string(index=False))
    print('Model accepted:', accepted)
    print('Reports saved to', output)


if __name__ == '__main__':
    main()
