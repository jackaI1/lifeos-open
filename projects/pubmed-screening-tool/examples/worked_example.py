"""Run a small, explicitly illustrative screening exercise without network access."""

import argparse
import json
from pathlib import Path

from pubmed_screening.client import PubMedClient, ReplayTransport
from pubmed_screening.workspace import Workspace


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=Path('demo-output'))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    args.out.mkdir(parents=True, exist_ok=True)
    db = args.out / 'review.sqlite'
    if db.exists():
        parser.error('Choose a fresh output directory; this example does not replace earlier screening')
    fixture = root / 'tests/fixtures/inhaler'
    query = (root / 'examples/query.txt').read_text().strip()
    with Workspace(db) as workspace:
        # A repeated search deliberately demonstrates cross-run duplicate removal.
        for _ in range(2):
            result = PubMedClient(ReplayTransport(fixture), interval=0).search(query, 6)
            workspace.add_search(result)
        workspace.export_screening(args.out / 'screening-before.csv')
        workspace.import_screening(root / 'examples/decisions.csv')
        workspace.export_screening(args.out / 'screening.csv')
        counts = workspace.report(args.out)
        assert counts['records_downloaded'] == 12
        assert counts['duplicates_removed'] == 6
        assert counts['included_title_abstract'] == 2
        assert counts['excluded'] == 4
        assert counts['pending'] == 0
    print(json.dumps(counts, indent=2))
    print('Illustrative title/abstract decisions only; full-text assessment has not been done.')
    print('Reports saved to ' + str(args.out))


if __name__ == '__main__':
    main()
