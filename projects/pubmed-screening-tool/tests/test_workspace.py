import csv
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from pubmed_screening.client import PubMedClient, ReplayTransport
from pubmed_screening.workspace import Workspace

FIXTURE = Path(__file__).parent / 'fixtures' / 'inhaler'
QUERY = json.loads((FIXTURE / 'manifest.json').read_text())['query']


def recorded_result():
    return PubMedClient(ReplayTransport(FIXTURE), interval=0).search(QUERY, 6)


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.db = self.path / 'review.sqlite'
        self.ws = Workspace(self.db)
        self.addCleanup(self.ws.close)

    def test_runs_are_persistent_and_keep_counts_dates_and_raw_responses(self):
        self.ws.add_search(recorded_result())
        with Workspace(self.db) as other:
            logs = other.queries()
            self.assertEqual(len(logs), 1)
            self.assertEqual(logs[0]['query'], QUERY)
            self.assertEqual(logs[0]['downloaded'], 6)
            self.assertEqual(logs[0]['source'], 'recorded')
            self.assertTrue(logs[0]['searched_at'])
            self.assertTrue(logs[0]['captured_at'])
            self.assertTrue(logs[0]['truncated'])
            self.assertIn('PubmedArticleSet', other.search_detail(1)['responses'][1]['body'])

    def test_repeat_search_dedupes_and_preserves_screening(self):
        self.ws.add_search(recorded_result())
        self.ws.decide('31264482', 'include', 'Inhaler design and patient handling')
        self.ws.add_search(recorded_result())
        flow = self.ws.counts()
        self.assertEqual(flow['records_downloaded'], 12)
        self.assertEqual(flow['duplicates_removed'], 6)
        self.assertEqual(flow['records_to_screen'], 6)
        self.assertEqual(flow['included_title_abstract'], 1)
        self.assertEqual(flow['pending'], 5)
        self.assertEqual(flow['searches_truncated'], 2)
        self.assertGreater(flow['matched_across_queries_with_overlap'], 12)

    def test_editable_csv_roundtrip_includes_abstracts_and_reason(self):
        self.ws.add_search(recorded_result())
        file = self.path / 'screen.csv'
        self.ws.export_screening(file)
        with file.open(newline='') as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(len(rows), 6)
        self.assertTrue(rows[0]['abstract'])
        rows[0].update(decision='exclude', reason='Environmental review outside question')
        rows[1].update(decision='include', reason='Device usability review')
        with file.open('w', newline='') as f:
            writer = csv.DictWriter(f, rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        self.assertEqual(self.ws.import_screening(file), 2)
        self.assertEqual(self.ws.counts()['pending'], 4)
        self.assertEqual(self.ws.counts()['excluded'], 1)
        self.ws.report(self.path / 'output')
        with (self.path / 'output/included.csv').open(newline='') as f:
            included = list(csv.DictReader(f))
        self.assertEqual([r['pmid'] for r in included], ['31264482'])
        self.assertEqual(included[0]['query_ids'], '1')
        flow = json.loads((self.path / 'output/flow.json').read_text())
        self.assertEqual(flow['included_title_abstract'], 1)
        self.assertIn('Title/abstract', (self.path / 'output/flow.txt').read_text())
        self.assertEqual(len(json.loads((self.path / 'output/queries.json').read_text())), 1)

    def test_invalid_import_is_atomic_and_identifies_bad_rows(self):
        self.ws.add_search(recorded_result())
        file = self.path / 'bad.csv'
        file.write_text('pmid,decision,reason\n32500439,include,Relevant\n99999999,exclude,Wrong\n')
        with self.assertRaises(ValueError):
            self.ws.import_screening(file)
        self.assertEqual(self.ws.counts()['records_screened'], 0)
        self.assertEqual(self.ws.history(), [])

    def test_decisions_require_reason_known_pmid_and_valid_status(self):
        self.ws.add_search(recorded_result())
        for pmid, status, reason in [('32500439', 'include', ''), ('32500439', 'exclude', '  '),
                                     ('wrong', 'exclude', 'x'), ('32500439', 'maybe', 'x')]:
            with self.subTest(status=status, pmid=pmid), self.assertRaises(ValueError):
                self.ws.decide(pmid, status, reason)
        self.assertEqual(self.ws.history(), [])

    def test_rescreening_and_reset_keep_audit_history(self):
        self.ws.add_search(recorded_result())
        self.ws.decide('32500439', 'exclude', 'Wrong scope')
        self.ws.decide('32500439', 'include', 'Scope broadened')
        self.assertEqual(self.ws.counts()['included_title_abstract'], 1)
        self.ws.decide('32500439', 'pending', '')
        self.assertEqual(self.ws.counts()['pending'], 6)
        events = self.ws.history()
        self.assertEqual([e['decision'] for e in events], ['exclude', 'include', 'pending'])
        self.assertTrue(all(e['decided_at'] for e in events))

    def test_duplicate_import_pmids_are_rejected(self):
        self.ws.add_search(recorded_result())
        file = self.path / 'bad.csv'
        file.write_text('pmid,decision,reason\n32500439,include,Yes\n32500439,exclude,No\n')
        with self.assertRaises(ValueError):
            self.ws.import_screening(file)
        self.assertEqual(self.ws.history(), [])

    def test_csv_cells_are_protected_and_database_cannot_be_overwritten(self):
        result = recorded_result()
        result['records'][0]['title'] = '=HYPERLINK("bad")'
        self.ws.add_search(result)
        file = self.path / 'screen.csv'
        self.ws.export_screening(file)
        with file.open(newline='') as f:
            self.assertTrue(next(csv.DictReader(f))['title'].startswith("'="))
        with self.assertRaises(ValueError):
            self.ws.export_screening(self.db)

    def test_csv_reason_roundtrip_preserves_literal_formula_text(self):
        self.ws.add_search(recorded_result())
        self.ws.decide('32500439', 'exclude', '=uncertain scope')
        file = self.path / 'screen.csv'
        self.ws.export_screening(file)
        self.assertEqual(self.ws.import_screening(file), 0)
        self.assertEqual(self.ws.counts()['exclusion_reasons'], {'=uncertain scope': 1})

    def test_report_uses_one_snapshot_while_another_connection_screens(self):
        self.ws.add_search(recorded_result())
        updated, committed = threading.Event(), threading.Event()
        errors = []
        def writer():
            try:
                with Workspace(self.db) as other:
                    with other.connection:
                        other.connection.execute("INSERT INTO screening_events(pmid,decision,reason,decided_at) VALUES ('31264482','include','Concurrent decision','2026-11-06T00:00:00+00:00')")
                        updated.set()
                    committed.set()
            except Exception as exc:
                errors.append(exc)
                updated.set()
        thread = threading.Thread(target=writer)
        original = self.ws._decisions
        started = False
        def decisions():
            nonlocal started
            result = original()
            if not started:
                started = True
                thread.start()
                self.assertTrue(updated.wait(2))
                # A real read snapshot holds the writer's commit until reporting ends.
                committed.wait(.1)
            return result
        try:
            with patch.object(self.ws, '_decisions', side_effect=decisions):
                flow = self.ws.report(self.path / 'snapshot')
        finally:
            thread.join(timeout=3)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        with (self.path / 'snapshot/included.csv').open(newline='') as f:
            self.assertEqual(flow['included_title_abstract'], len(list(csv.DictReader(f))))
        self.assertEqual(flow['included_title_abstract'], 0)
        self.assertEqual(self.ws.counts()['included_title_abstract'], 1)

    def test_group_merging_exposes_conflicts_and_can_be_resolved(self):
        result = recorded_result()
        self.ws.add_search(result)
        self.ws.decide('32500439', 'include', 'Yes')
        self.ws.decide('31264482', 'exclude', 'No')
        result['records'][0]['doi'] = result['records'][1]['doi']
        self.ws.add_search(result)
        with self.assertRaisesRegex(ValueError, 'conflict'):
            self.ws.counts()
        self.ws.decide('32500439', 'include', 'Resolved duplicate review')
        self.assertEqual(self.ws.counts()['records_to_screen'], 5)
        self.assertEqual(self.ws.counts()['included_title_abstract'], 1)


class CLITests(unittest.TestCase):
    def test_full_cli_workflow_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            db = str(path / 'review.sqlite')
            def cli(*args, expected=0):
                proc = subprocess.run([sys.executable, '-m', 'pubmed_screening', *args], capture_output=True, text=True, timeout=15)
                self.assertEqual(proc.returncode, expected, proc.stderr)
                return proc.stdout
            cli('search', '--db', db, '--query', QUERY, '--max-records', '6', '--recorded', str(FIXTURE))
            cli('screening', '--db', db, '--output', str(path / 'screen.csv'))
            cli('decide', '--db', db, '--pmid', '31264482', '--decision', 'include', '--reason', 'Device handling')
            cli('report', '--db', db, '--out', str(path / 'results'))
            self.assertTrue((path / 'results/included.csv').exists())
            self.assertEqual(json.loads(cli('queries', '--db', db))[0]['query'], QUERY)
            self.assertIn('Device handling', cli('history', '--db', db))
            cli('decide', '--db', db, '--pmid', '31264482', '--decision', 'exclude', '--reason', '', expected=2)
            built = cli('build-query', '--mesh', 'Metered Dose Inhalers', '--boolean', 'usability[tiab]')
            self.assertIn('"Metered Dose Inhalers"[MeSH Terms]', built)
