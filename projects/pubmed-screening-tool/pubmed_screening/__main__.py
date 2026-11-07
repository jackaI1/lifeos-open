"""Command-line entry point: python -m pubmed_screening --help."""

import argparse
import json
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from .client import PubMedClient, ReplayTransport
from .core import build_query
from .workspace import Workspace


def main(argv=None):
    parser = argparse.ArgumentParser(description='Search PubMed, screen abstracts, and export auditable review counts.')
    commands = parser.add_subparsers(dest='command', required=True)
    builder = commands.add_parser('build-query', help='Combine MeSH headings and a Boolean expression')
    builder.add_argument('--mesh', action='append', default=[], help='Related MeSH heading, repeat to OR headings')
    builder.add_argument('--boolean', default='', help='Boolean expression to AND with the MeSH group')
    search = commands.add_parser('search', help='Download and archive a PubMed search')
    source = search.add_mutually_exclusive_group(required=True)
    source.add_argument('--query', help='Exact PubMed query, including any field tags')
    source.add_argument('--query-file', type=Path, help='UTF-8 file containing the exact query')
    search.add_argument('--max-records', type=int, default=200, help='Retrieval cap 1..9999, default 200; recorded in query log')
    search.add_argument('--recorded', type=Path, help='Replay a recorded manifest instead of using the network')
    screening = commands.add_parser('screening', help='Export an editable CSV with titles and abstracts')
    screening.add_argument('--output', type=Path, required=True)
    decide = commands.add_parser('decide', help='Record or revise a human decision with a reason')
    decide.add_argument('--pmid', required=True)
    decide.add_argument('--decision', choices=['include', 'exclude', 'pending'], required=True)
    decide.add_argument('--reason', default='', help='Required for include/exclude')
    importing = commands.add_parser('import-screening', help='Import edited CSV decisions atomically')
    importing.add_argument('--input', type=Path, required=True)
    report = commands.add_parser('report', help='Write counts, included studies, and query log')
    report.add_argument('--out', type=Path, required=True)
    commands.add_parser('queries', help='Print the dated query log')
    commands.add_parser('history', help='Print the append-only decision history')
    detail = commands.add_parser('search-detail', help='Export a run including raw E-utilities responses')
    detail.add_argument('--id', type=int, required=True)
    detail.add_argument('--output', type=Path, required=True)
    for name, subparser in commands.choices.items():
        if name != 'build-query':
            subparser.add_argument('--db', type=Path, required=True, help='SQLite workspace file')
    args = parser.parse_args(argv)
    try:
        if args.command == 'build-query':
            print(build_query(args.mesh, args.boolean))
            return 0
        # Download before opening the database; failed searches leave no saved run.
        if args.command == 'search':
            query = args.query if args.query is not None else args.query_file.read_text(encoding='utf-8').strip()
            client = PubMedClient(transport=ReplayTransport(args.recorded), interval=0) if args.recorded else PubMedClient()
            result = client.search(query, args.max_records)
        elif not args.db.is_file():
            raise ValueError('Workspace does not exist; run search first')
        with Workspace(args.db) as workspace:
            if args.command == 'search':
                run_id = workspace.add_search(result)
                print(json.dumps(dict(id=run_id, matched=result['matched'], downloaded=len(result['records']),
                                      truncated=result['truncated'], warnings=result['warnings'])))
            elif args.command == 'screening':
                workspace.export_screening(args.output)
                print('Screening CSV saved to ' + str(args.output))
            elif args.command == 'decide':
                print(json.dumps(dict(changed=workspace.decide(args.pmid, args.decision, args.reason))))
            elif args.command == 'import-screening':
                print(json.dumps(dict(changed=workspace.import_screening(args.input))))
            elif args.command == 'report':
                print(json.dumps(workspace.report(args.out), indent=2))
            elif args.command == 'queries':
                print(json.dumps(workspace.queries(), indent=2))
            elif args.command == 'history':
                print(json.dumps(workspace.history(), indent=2))
            elif args.command == 'search-detail':
                if args.output.resolve() == args.db.resolve():
                    raise ValueError('Export cannot overwrite the workspace database')
                args.output.write_text(json.dumps(workspace.search_detail(args.id), indent=2) + '\n', encoding='utf-8')
    except (ValueError, OSError, sqlite3.Error, ET.ParseError) as exc:
        print('Error: ' + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
