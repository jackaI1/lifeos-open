import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from clip_export.edits import Edit
from clip_export.media import export_clips, probe, packet_endpoint

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')


def ff(*args):
    return subprocess.run([FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', *map(str, args)],
                          check=True, capture_output=True, timeout=120).stdout


def pixels(path, time):
    return ff('-ss', time, '-i', path, '-frames:v', '1', '-vf', 'scale=160:160', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')


class MediaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='clip-export-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / "source ' [test].mp4"
        ff('-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
           '-vf', 'drawbox=x=120:y=50:w=80:h=80:color=red:t=fill', '-c:v', 'libx264', '-preset', 'ultrafast',
           '-af', 'volume=0.1', '-c:a', 'aac', '-shortest', cls.source)
        cls.srt = cls.root / 'source.srt'
        cls.srt.write_text('1\n00:00:01,500 --> 00:00:02,300\nA VISIBLE CAPTION\n')
        cls.outputs = export_clips(cls.source, [Edit('opening', 1, 3)], cls.root / 'exports', cls.srt)

    def test_ffprobe_dimensions_duration_and_audio(self):
        self.assertEqual(len(self.outputs), 3)
        expected = {'vertical': (1080, 1920), 'square': (1080, 1080), 'widescreen': (1920, 1080)}
        for path in self.outputs:
            with self.subTest(path=path.name):
                data = probe(path)
                video = next(s for s in data['streams'] if s['codec_type'] == 'video')
                audio = next(s for s in data['streams'] if s['codec_type'] == 'audio')
                shape = path.stem.split('-')[-1]
                self.assertEqual((video['width'], video['height']), expected[shape])
                self.assertEqual(video['sample_aspect_ratio'], '1:1')
                self.assertAlmostEqual(float(data['format']['duration']), 2, delta=.1)
                self.assertEqual(audio['sample_rate'], '48000')

    def test_caption_pixels_appear_only_inside_shifted_cue(self):
        path = next(p for p in self.outputs if 'square' in p.name)
        def white_count(t):
            raw = pixels(path, t)
            return sum(all(c > 180 for c in raw[i:i+3]) for i in range(160 * 105 * 3, len(raw), 3))
        self.assertLess(white_count(.2), 5)
        self.assertGreater(white_count(.8), 20)
        self.assertLess(white_count(1.6), 5)

    def test_pad_keeps_picture_and_crop_fills_frame(self):
        padded = next(p for p in self.outputs if 'square' in p.name)
        cropped = export_clips(self.source, [Edit('fill', 0, 1)], self.root / 'cropped', formats=['square'], fit='crop')[0]
        pad_raw, crop_raw = pixels(padded, .2), pixels(cropped, .2)
        self.assertLess(max(pad_raw[:3]), 10)
        self.assertGreater(crop_raw[2], 150)
        # A red square stays square after both transforms; stretching would change this ratio.
        for raw in [pad_raw, crop_raw]:
            red = [(i // 3 % 160, i // 3 // 160) for i in range(0, len(raw), 3)
                   if raw[i] > 180 and raw[i+1] < 60 and raw[i+2] < 60]
            width = max(x for x, y in red) - min(x for x, y in red)
            height = max(y for x, y in red) - min(y for x, y in red)
            self.assertAlmostEqual(width / height, 1, delta=.06)

    def test_audio_measures_near_minus_16_lufs(self):
        path = self.outputs[0]
        result = subprocess.run([FFMPEG, '-hide_banner', '-nostdin', '-i', str(path), '-af',
                                 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-vn', '-f', 'null', '-'],
                                check=True, capture_output=True, text=True, timeout=120)
        stats = json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}') + 1])
        self.assertAlmostEqual(float(stats['input_i']), -16, delta=1)
        self.assertLessEqual(float(stats['input_tp']), -1.0)

    def test_silent_source_gets_silent_audio_and_invalid_cut_creates_nothing(self):
        silent = self.root / 'silent.mp4'
        ff('-i', self.source, '-an', '-c:v', 'copy', silent)
        out = export_clips(silent, [Edit('silent', 0, 1)], self.root / 'silent-out', formats=['square'])[0]
        self.assertTrue(any(s['codec_type'] == 'audio' for s in probe(out)['streams']))
        bad_dir = self.root / 'bad-out'
        with self.assertRaises(ValueError):
            export_clips(self.source, [Edit('valid', 0, 1), Edit('past-end', 4, 6)], bad_dir)
        self.assertFalse(bad_dir.exists())

    def test_existing_exports_are_preserved(self):
        original = self.outputs[0].read_bytes()
        with self.assertRaises(FileExistsError):
            export_clips(self.source, [Edit('opening', 1, 3)], self.root / 'exports', self.srt)
        self.assertEqual(self.outputs[0].read_bytes(), original)

    def test_anamorphic_pixels_are_corrected_without_stretching(self):
        source = self.root / 'anamorphic.mp4'
        ff('-i', self.source, '-vf', 'scale=160:180,setsar=2', '-an', '-c:v', 'libx264', source)
        out = export_clips(source, [Edit('anamorphic', 0, 1)], self.root / 'anamorphic-out', formats=['square'])[0]
        raw = pixels(out, .2)
        red = [(i // 3 % 160, i // 3 // 160) for i in range(0, len(raw), 3)
               if raw[i] > 180 and raw[i+1] < 60 and raw[i+2] < 60]
        width = max(x for x, y in red) - min(x for x, y in red)
        height = max(y for x, y in red) - min(y for x, y in red)
        self.assertAlmostEqual(width / height, 1, delta=.06)

    def test_existing_silent_audio_stays_silent(self):
        source = self.root / 'silent-track.mp4'
        ff('-i', self.source, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v:0',
           '-map', '1:a:0', '-t', '1', '-c:v', 'copy', '-c:a', 'aac', source)
        out = export_clips(source, [Edit('quiet', 0, 1)], self.root / 'quiet-out', formats=['square'])[0]
        pcm = ff('-i', out, '-vn', '-f', 's16le', '-')
        self.assertTrue(pcm)
        self.assertEqual(max(pcm), 0)

    def test_encoding_failure_removes_owned_staging_files(self):
        output = self.root / 'failed-export'
        with patch.dict(os.environ, {'FFMPEG': 'clip-export-no-such-executable'}):
            with self.assertRaises(ValueError):
                export_clips(self.source, [Edit('failure', 0, 1)], output, formats=['square'])
        self.assertEqual(list(output.iterdir()), [])
        self.assertTrue(self.source.is_file())

    def test_cuts_after_short_audio_ends_keep_full_length_audio(self):
        source = self.root / 'short-audio.mp4'
        ff('-i', self.source, '-f', 'lavfi', '-i', 'sine=duration=0.5', '-map', '0:v:0', '-map', '1:a:0',
           '-c:v', 'copy', '-c:a', 'aac', source)
        for name, start, end in [('tail', 1, 2), ('partial', 0, 2)]:
            out = export_clips(source, [Edit(name, start, end)], self.root / name, formats=['square'])[0]
            data = probe(out)
            audio = next((s for s in data['streams'] if s['codec_type'] == 'audio'), None)
            self.assertIsNotNone(audio, 'A silent interval still needs an audio stream for rough cuts')
            self.assertAlmostEqual(float(audio['duration']), end - start, delta=.05)

    def test_delayed_audio_keeps_its_source_timing(self):
        source = self.root / 'delayed-audio.mp4'
        ff('-i', self.source, '-itsoffset', '1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
           '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', source)
        out = export_clips(source, [Edit('delay', .5, 2.5)], self.root / 'delay-out', formats=['square'])[0]
        before = ff('-ss', '0.1', '-i', out, '-t', '0.2', '-vn', '-f', 's16le', '-')
        during = ff('-ss', '0.8', '-i', out, '-t', '0.2', '-vn', '-f', 's16le', '-')
        after = ff('-ss', '1.8', '-i', out, '-t', '0.1', '-vn', '-f', 's16le', '-')
        self.assertEqual(max(before), 0)
        self.assertGreater(max(during), 20)
        self.assertEqual(max(after), 0)

    def test_mkv_with_longer_audio_cannot_export_past_video_end(self):
        source = self.root / 'short-picture.mkv'
        ff('-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=1', '-f', 'lavfi', '-i', 'sine=duration=3',
           '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', source)
        self.assertAlmostEqual(packet_endpoint(source), 1, delta=.05)
        output = self.root / 'past-picture'
        with self.assertRaises(ValueError):
            export_clips(source, [Edit('past-picture', 2, 3)], output, formats=['square'])
        self.assertFalse(output.exists())
