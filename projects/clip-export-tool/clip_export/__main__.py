"""Command-line entry point. JSON output keeps catalogue results scriptable."""
import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

from .catalogue import Catalogue, rough_cut
from .edits import load_edits
from .media import FORMATS, export_clips


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Cut, caption and resize footage; search a local clip catalogue.')
    commands = parser.add_subparsers(dest='command', required=True)
    export = commands.add_parser('export', help='Export each edit as captioned MP4 files')
    export.add_argument('source', type=Path)
    export.add_argument('edits', type=Path)
    export.add_argument('--captions', type=Path, help='SRT with timestamps relative to the source video')
    export.add_argument('--out', type=Path, required=True)
    export.add_argument('--formats', nargs='+', choices=list(FORMATS), default=list(FORMATS))
    export.add_argument('--fit', choices=['pad', 'crop'], default='pad')
    catalogue = commands.add_parser('catalogue', help='Import named intervals or search footage')
    actions = catalogue.add_subparsers(dest='action', required=True)
    add = actions.add_parser('import')
    add.add_argument('source', type=Path)
    add.add_argument('edits', type=Path)
    add.add_argument('--captions', type=Path)
    add.add_argument('--db', type=Path, required=True)
    search = actions.add_parser('search')
    search.add_argument('--db', type=Path, required=True)
    search.add_argument('--query', default='', help='Literal text in a clip name or tag')
    search.add_argument('--tag', default='', help='Exact tag, ignoring case')
    rough = commands.add_parser('rough-cut', help='Join catalogue IDs in the supplied order')
    rough.add_argument('--db', type=Path, required=True)
    rough.add_argument('--ids', type=int, nargs='+', required=True)
    rough.add_argument('--output', type=Path, required=True)
    rough.add_argument('--format', choices=list(FORMATS), default='widescreen')
    rough.add_argument('--fit', choices=['pad', 'crop'], default='pad')
    args = parser.parse_args(argv)
    try:
        if args.command == 'export':
            result = [str(p) for p in export_clips(args.source, load_edits(args.edits), args.out,
                                                   args.captions, args.formats, args.fit)]
        elif args.command == 'rough-cut':
            result = str(rough_cut(Catalogue(args.db), args.ids, args.output, args.format, args.fit))
        elif args.action == 'import':
            result = {'ids': Catalogue(args.db).add(args.source, load_edits(args.edits), args.captions)}
        else:
            result = Catalogue(args.db).search(args.query, args.tag)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, sqlite3.Error, subprocess.TimeoutExpired) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
