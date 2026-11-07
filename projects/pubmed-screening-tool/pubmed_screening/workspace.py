"""Transactional search archive, human screening history, and review exports."""

import csv
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .core import deduplicate, flow_counts, group_decision

COLUMNS = ['pmid', 'alias_pmids', 'doi', 'title', 'abstract', 'year', 'journal',
           'query_ids', 'decision', 'reason', 'pubmed_url']


def _safe_cell(value):
    text = str(value)
    # CSV quoting alone does not stop spreadsheet formula execution.
    return "'" + text if (text.startswith(("'", '\t', '\r', '\n')) or
                             text.lstrip().startswith(('=', '+', '-', '@'))) else text


def _unescape_cell(text):
    if text.startswith("'") and _safe_cell(text[1:]) == text:
        return text[1:]
    return text


class Workspace:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, timeout=10)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript('''
            CREATE TABLE IF NOT EXISTS searches (
                id INTEGER PRIMARY KEY, result_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS screening_events (
                id INTEGER PRIMARY KEY, pmid TEXT NOT NULL, decision TEXT NOT NULL,
                reason TEXT NOT NULL, decided_at TEXT NOT NULL
            );
        ''')

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def add_search(self, result):
        # The complete download and raw responses enter the archive in one transaction.
        with self.connection:
            cursor = self.connection.execute('INSERT INTO searches(result_json) VALUES (?)',
                                             (json.dumps(result),))
        return cursor.lastrowid

    def search_detail(self, run_id):
        row = self.connection.execute('SELECT result_json FROM searches WHERE id=?', (run_id,)).fetchone()
        if row is None:
            raise ValueError('Unknown search ID')
        return json.loads(row['result_json'])

    def queries(self):
        logs = []
        for row in self.connection.execute('SELECT id,result_json FROM searches ORDER BY id'):
            result = json.loads(row['result_json'])
            logs.append({k: v for k, v in result.items() if k not in ('records', 'responses')} |
                        dict(id=row['id'], downloaded=len(result['records'])))
        return logs

    def _groups(self):
        records, sources = [], {}
        for row in self.connection.execute('SELECT id,result_json FROM searches ORDER BY id'):
            for record in json.loads(row['result_json'])['records']:
                records.append(record)
                sources.setdefault(record['pmid'], set()).add(row['id'])
        groups = deduplicate(records)
        for group in groups:
            group['query_ids'] = sorted(set().union(*(sources[p] for p in group['pmids'])))
        return groups

    def _decisions(self):
        return {row['pmid']: (row['decision'], row['reason']) for row in
                self.connection.execute('SELECT pmid,decision,reason FROM screening_events ORDER BY id')}

    @staticmethod
    def _counts(groups, decisions, logs):
        return flow_counts(groups, decisions) | dict(
            matched_across_queries_with_overlap=sum(q['matched'] for q in logs),
            searches=len(logs), searches_truncated=sum(q['truncated'] for q in logs),
            scope='Title/abstract screening only; includes need full-text assessment')

    def counts(self):
        with self.connection:
            self.connection.execute('BEGIN')
            return self._counts(self._groups(), self._decisions(), self.queries())

    def history(self):
        return [dict(row) for row in self.connection.execute('SELECT * FROM screening_events ORDER BY id')]

    def _apply_decisions(self, rows):
        # Lock before reading aliases, so a parallel search/import cannot invalidate validation.
        with self.connection:
            self.connection.execute('BEGIN IMMEDIATE')
            groups = self._groups()
            by_pmid = {p: group for group in groups for p in group['pmids']}
            normalized, seen_groups = [], set()
            for row in rows:
                pmid = (row.get('pmid') or '').strip()
                status = (row.get('decision') or '').strip().lower()
                reason = (row.get('reason') or '').strip()
                if pmid not in by_pmid:
                    raise ValueError('Unknown PMID: ' + pmid)
                if status not in ('include', 'exclude', 'pending'):
                    raise ValueError('Decision must be include, exclude, or pending for PMID ' + pmid)
                if status != 'pending' and not reason:
                    raise ValueError('A reason is required for PMID ' + pmid)
                group = by_pmid[pmid]
                canonical = group['record']['pmid']
                if canonical in seen_groups:
                    raise ValueError('Duplicate screening rows for the same study: ' + pmid)
                seen_groups.add(canonical)
                normalized.append((group, status, reason))
            existing = self._decisions()
            changed = 0
            for group, status, reason in normalized:
                values = {existing[p] for p in group['pmids'] if p in existing}
                if values == {(status, reason)} or (not values and status == 'pending' and not reason):
                    continue
                decided_at = datetime.now(timezone.utc).isoformat()
                # Resolve the entire alias group; earlier events remain intact in the audit trail.
                for pmid in group['pmids']:
                    self.connection.execute(
                        'INSERT INTO screening_events(pmid,decision,reason,decided_at) VALUES (?,?,?,?)',
                        (pmid, status, reason, decided_at))
                changed += 1
        return changed

    def decide(self, pmid, decision, reason):
        return self._apply_decisions([dict(pmid=pmid, decision=decision, reason=reason)])

    def import_screening(self, path):
        with Path(path).open(newline='', encoding='utf-8-sig') as handle:
            reader = csv.DictReader(handle)
            if not {'pmid', 'decision', 'reason'} <= set(reader.fieldnames or []):
                raise ValueError('CSV requires pmid, decision, and reason columns')
            rows = list(reader)
            for row in rows:
                row['reason'] = _unescape_cell(row.get('reason') or '')
        return self._apply_decisions(rows)

    def _rows(self, groups, decisions, included_only=False):
        for group in groups:
            status, reason = group_decision(group, decisions)
            if included_only and status != 'include':
                continue
            record = group['record']
            yield record | dict(alias_pmids=';'.join(group['pmids']),
                                query_ids=';'.join(map(str, group['query_ids'])),
                                decision=status, reason=reason,
                                pubmed_url='https://pubmed.ncbi.nlm.nih.gov/' + record['pmid'] + '/')

    def _write_csv(self, path, rows):
        path = Path(path)
        if path.resolve() == self.path.resolve():
            raise ValueError('Export cannot overwrite the workspace database')
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('w', newline='', encoding='utf-8') as handle:
            writer = csv.DictWriter(handle, fieldnames=COLUMNS)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: _safe_cell(row[key]) for key in COLUMNS})

    def export_screening(self, path):
        with self.connection:
            self.connection.execute('BEGIN')
            rows = list(self._rows(self._groups(), self._decisions()))
        self._write_csv(path, rows)

    def report(self, directory):
        directory = Path(directory)
        targets = ['flow.json', 'flow.txt', 'included.csv', 'queries.json']
        if any((directory / name).resolve() == self.path.resolve() for name in targets):
            raise ValueError('Report cannot overwrite the workspace database')
        # Collect and validate everything before touching any output files.
        with self.connection:
            self.connection.execute('BEGIN')
            groups, decisions = self._groups(), self._decisions()
            queries = self.queries()
            counts = self._counts(groups, decisions, queries)
            rows = list(self._rows(groups, decisions, included_only=True))
        directory.mkdir(parents=True, exist_ok=True)
        self._write_csv(directory / 'included.csv', rows)
        (directory / 'flow.json').write_text(json.dumps(counts, indent=2) + '\n', encoding='utf-8')
        (directory / 'queries.json').write_text(json.dumps(queries, indent=2) + '\n', encoding='utf-8')
        lines = ['PRISMA-style flow: Title/abstract screening',
                 'Matched hits across searches (overlapping, not unique): ' + str(counts['matched_across_queries_with_overlap']),
                 'Searches with capped retrieval: ' + str(counts['searches_truncated']),
                 'Downloaded record occurrences: ' + str(counts['records_downloaded']),
                 'Duplicate occurrences removed: ' + str(counts['duplicates_removed']),
                 'Unique records to screen: ' + str(counts['records_to_screen']),
                 'Screened: ' + str(counts['records_screened']),
                 'Pending: ' + str(counts['pending']),
                 'Excluded: ' + str(counts['excluded']),
                 'Included at title/abstract stage: ' + str(counts['included_title_abstract'])]
        lines += ['  Excluded, ' + reason + ': ' + str(n) for reason, n in counts['exclusion_reasons'].items()]
        lines += ['', 'Includes require full-text assessment. This is not a completed systematic review.',
                  'Downloaded = duplicates removed + unique records.',
                  'Unique records = pending + excluded + included at title/abstract stage.']
        (directory / 'flow.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
        return counts
