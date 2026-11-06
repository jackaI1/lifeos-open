import json
import tempfile
import unittest
from pathlib import Path

from clip_export.edits import load_edits
from clip_export.captions import read_srt, clip_captions, write_srt


class EditingTests(unittest.TestCase):
    def test_edit_list_loads_names_seconds_and_tags(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'edits.json'
            path.write_text(json.dumps([{'name': 'opening', 'start': 1.25, 'end': 3.5, 'tags': ['earth', 'wide']}]))
            edit = load_edits(path)[0]
            self.assertEqual((edit.name, edit.start, edit.end, edit.tags), ('opening', 1.25, 3.5, ['earth', 'wide']))

    def test_invalid_edits_are_rejected_before_encoding(self):
        bad = [
            [{'name': '../outside', 'start': 0, 'end': 1}],
            [{'name': 'same', 'start': 0, 'end': 1}] * 2,
            [{'name': 'bad', 'start': 2, 'end': 1}],
            [{'name': 'bad', 'start': -1, 'end': 1}],
            [{'name': 'bad', 'start': 0, 'end': float('nan')}],
            [{'name': 'bad', 'start': True, 'end': 2}],
            [{'name': 'bad', 'start': 0, 'end': 1, 'tags': 'earth'}],
            [],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'edits.json'
            for value in bad:
                with self.subTest(value=value):
                    path.write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        load_edits(path)

    def test_source_captions_are_clamped_shifted_and_exclude_boundaries(self):
        text = ('1\n00:00:00,000 --> 00:00:01,000\nBefore\n\n'
                '2\n00:00:01,500 --> 00:00:02,500\nCrosses start\n\n'
                '3\n00:00:03,000 --> 00:00:05,000\nCrosses end\n\n'
                '4\n00:00:04,000 --> 00:00:06,000\nAfter\n')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'captions.srt'
            path.write_text(text)
            cues = clip_captions(read_srt(path), 2, 4)
            self.assertEqual([(c.start, c.end, c.text) for c in cues], [(0, .5, 'Crosses start'), (1, 2, 'Crosses end')])
            write_srt(path, cues)
            self.assertEqual(read_srt(path), cues)

    def test_bad_srt_reports_invalid_timing_instead_of_dropping_cues(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'bad.srt'
            for timing in ['00:00:03,000 --> 00:00:02,000', '00:61:00,000 --> 00:62:00,000', 'wrong']:
                path.write_text('1\n' + timing + '\nCaption\n')
                with self.subTest(timing=timing), self.assertRaises(ValueError):
                    read_srt(path)
