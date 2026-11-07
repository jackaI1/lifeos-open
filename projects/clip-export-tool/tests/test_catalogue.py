import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from clip_export.catalogue import Catalogue, rough_cut
from clip_export.edits import Edit
from clip_export.media import probe
from tests.test_media import ff


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='catalogue-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'recording.mp4'
        ff('-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=30:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', self.source)
        self.db = self.root / 'footage.sqlite'
        self.cat = Catalogue(self.db)

    def test_import_search_and_reimport_keep_ids_and_update_tags(self):
        ids = self.cat.add(self.source, [Edit('rainfall', 0, 1, ['Storm', '100%']), Edit('earth-wide', 1, 2, ['space', '100percent'])])
        self.assertEqual(len(ids), 2)
        self.assertEqual([r['id'] for r in self.cat.search(query='RAIN')], [ids[0]])
        self.assertEqual([r['id'] for r in self.cat.search(query='100%')], [ids[0]])
        self.assertEqual(self.cat.search(query="' OR 1=1 --"), [])
        self.assertEqual(self.cat.search(tag='sto'), [])
        self.assertEqual([r['id'] for r in self.cat.search(tag='STORM')], [ids[0]])
        updated = self.cat.add(self.source, [Edit('rainfall', .2, 1.2, ['revised'])])
        self.assertEqual(updated, [ids[0]])
        self.assertEqual(self.cat.search(tag='storm'), [])
        self.assertEqual(self.cat.search(tag='revised')[0]['start'], .2)
        self.assertEqual(len(self.cat.search()), 2)

    def test_bad_import_is_atomic(self):
        with self.assertRaises(ValueError):
            self.cat.add(self.source, [Edit('good', 0, 1), Edit('bad', 2, 4)])
        self.assertEqual(self.cat.search(), [])

    def test_ordered_multisource_rough_cut_has_expected_duration(self):
        second = self.root / 'other.mp4'
        ff('-f', 'lavfi', '-i', 'color=c=red:s=120x160:r=24:d=2', '-f', 'lavfi', '-i', 'sine=duration=2',
           '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', second)
        first_id = self.cat.add(self.source, [Edit('green', .5, 1.5)])[0]
        second_id = self.cat.add(second, [Edit('red', 0, 1)])[0]
        out = self.root / 'rough.mp4'
        rough_cut(self.cat, [second_id, first_id], out, 'square')
        data = probe(out)
        self.assertAlmostEqual(float(data['format']['duration']), 2, delta=.12)
        self.assertEqual((data['streams'][0]['width'], data['streams'][0]['height']), (1080, 1080))
        raw_first = ff('-ss', '0.2', '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
        raw_second = ff('-ss', '1.4', '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')
        self.assertGreater(raw_first[0], raw_first[1] * 2)
        self.assertGreater(raw_second[1], raw_second[0] * 2)
        with self.assertRaises(FileExistsError):
            rough_cut(self.cat, [first_id], out, 'square')

    def test_missing_id_fails_without_partial_output(self):
        first_id = self.cat.add(self.source, [Edit('green', 0, 1)])[0]
        out = self.root / 'bad.mp4'
        with self.assertRaises(ValueError):
            rough_cut(self.cat, [first_id, 999999], out, 'square')
        self.assertFalse(out.exists())
        self.assertEqual(list(self.root.glob('.rough-cut-*')), [])

    def test_cli_round_trip_and_errors(self):
        edits = self.root / 'edits.json'
        edits.write_text(json.dumps([{'name': 'opening', 'start': 0, 'end': 1, 'tags': ['storm']}]))
        def cli(*args):
            return subprocess.run([sys.executable, '-m', 'clip_export', *map(str, args)], capture_output=True, text=True, timeout=120)
        imported = cli('catalogue', 'import', self.source, edits, '--db', self.db)
        self.assertEqual(imported.returncode, 0, imported.stderr)
        searched = cli('catalogue', 'search', '--db', self.db, '--tag', 'storm')
        self.assertEqual(json.loads(searched.stdout)[0]['name'], 'opening')
        exported = cli('export', self.source, edits, '--out', self.root / 'exports', '--formats', 'square')
        self.assertEqual(exported.returncode, 0, exported.stderr)
        self.assertTrue((self.root / 'exports' / 'opening-square.mp4').is_file())
        failed = cli('export', self.source, self.root / 'missing.json', '--out', self.root / 'bad')
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn('error:', failed.stderr)
        self.assertNotIn('Traceback', failed.stderr)
