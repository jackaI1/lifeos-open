import tempfile
import unittest
from pathlib import Path
from stream.validate import validate, ValidationError


class PlaylistTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        master = ['#EXTM3U', '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English, demo",LANGUAGE="en",URI="captions.m3u8"']
        for name, bandwidth, resolution in [('high', 2000000, '1280x720'), ('medium', 1000000, '854x480'), ('low', 500000, '640x360')]:
            master += [f'#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={resolution},CODECS="avc1.42c01f,mp4a.40.2",SUBTITLES="subs"', name + '.m3u8']
            self.write(name + '.m3u8', self.playlist(name + '.ts'))
            self.write(name + '.ts', 'media')
        self.write('master.m3u8', '\n'.join(master))
        self.write('captions.m3u8', self.playlist('captions.vtt'))
        self.write('captions.vtt', 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n')

    def write(self, name, content):
        (self.root / name).write_text(content)

    def edit(self, name, old, new):
        p = self.root / name
        p.write_text(p.read_text().replace(old, new))

    def playlist(self, segment):
        return f'#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.000,\n{segment}\n#EXT-X-ENDLIST\n'

    def check(self, **kwargs):
        return validate(str(self.root / 'master.m3u8'), min_duration=2, **kwargs)

    def test_valid_three_qualities_and_captions(self):
        report = self.check()
        self.assertEqual(report['renditions'], 3)
        self.assertEqual(report['video_segments'], 3)
        self.assertEqual(report['caption_cues'], 1)
        self.assertEqual(report['duration_seconds'], 2)

    def test_missing_segment(self):
        (self.root / 'low.ts').unlink()
        with self.assertRaises(ValidationError): self.check()

    def test_empty_segment(self):
        self.write('low.ts', '')
        with self.assertRaises(ValidationError): self.check()

    def test_missing_endlist(self):
        self.edit('low.m3u8', '#EXT-X-ENDLIST', '')
        with self.assertRaises(ValidationError): self.check()

    def test_live_accepts_unfinished_playlist(self):
        for p in self.root.glob('*.m3u8'):
            p.write_text(p.read_text().replace('#EXT-X-ENDLIST', ''))
        self.assertEqual(self.check(live=True)['renditions'], 3)

    def test_rejects_unaligned_renditions(self):
        self.edit('low.m3u8', '2.000', '1.5')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_duration_above_target(self):
        self.edit('low.m3u8', '2.000', '3.1')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_nan_and_negative_duration(self):
        for duration in ['nan', '-2', '0', 'inf']:
            with self.subTest(duration=duration):
                self.write('low.m3u8', self.playlist('low.ts').replace('2.000', duration))
                with self.assertRaises(ValidationError): self.check()

    def test_rejects_dangling_extinf(self):
        self.edit('low.m3u8', 'low.ts', '')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_short_stream(self):
        with self.assertRaises(ValidationError):
            validate(str(self.root / 'master.m3u8'), min_duration=10)

    def test_rejects_path_escape_and_external_urls(self):
        for uri in ['../outside.ts', '/etc/passwd', 'https://example.com/a.ts', '%2e%2e/a.ts', 'low.ts?x=1', 'low.ts#x']:
            with self.subTest(uri=uri):
                self.write('low.m3u8', self.playlist(uri))
                with self.assertRaises(ValidationError): self.check()

    def test_rejects_symlink_escape(self):
        (self.root / 'low.ts').unlink()
        (self.root / 'low.ts').symlink_to('/etc/hosts')
        with self.assertRaises(ValidationError): self.check()

    def test_requires_three_distinct_bitrates_and_resolutions(self):
        for old, new in [('BANDWIDTH=500000', 'BANDWIDTH=1000000'), ('640x360', '854x480')]:
            with self.subTest(old=old):
                original = (self.root / 'master.m3u8').read_text()
                self.edit('master.m3u8', old, new)
                with self.assertRaises(ValidationError): self.check()
                self.write('master.m3u8', original)

    def test_requires_caption_link_on_each_quality(self):
        self.edit('master.m3u8', ',SUBTITLES="subs"', '')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_unknown_caption_group(self):
        self.edit('master.m3u8', 'SUBTITLES="subs"', 'SUBTITLES="missing"')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_invalid_webvtt(self):
        self.write('captions.vtt', 'not WebVTT')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_reversed_caption_time(self):
        self.edit('captions.vtt', '00:00.000 --> 00:02.000', '00:03.000 --> 00:02.000')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_caption_track_without_cues(self):
        self.write('captions.vtt', 'WEBVTT\n\n')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_caption_outside_segment_timeline(self):
        self.edit('captions.vtt', '00:00.000 --> 00:02.000', '00:20.000 --> 00:22.000')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_mismatched_sequence(self):
        self.edit('low.m3u8', 'SEQUENCE:0', 'SEQUENCE:4')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_bad_header(self):
        self.edit('master.m3u8', '#EXTM3U', '#nope')
        with self.assertRaises(ValidationError): self.check()

    def test_rejects_duplicate_variant(self):
        self.edit('master.m3u8', 'low.m3u8', 'high.m3u8')
        with self.assertRaises(ValidationError): self.check()

    def test_live_rejects_rendition_more_than_one_segment_behind(self):
        self.write('high.m3u8', self.playlist('high.ts').replace('#EXT-X-ENDLIST', '#EXTINF:2.000,\nhigh.ts\n#EXTINF:2.000,\nhigh.ts\n'))
        with self.assertRaises(ValidationError): self.check(live=True)

    def test_live_rejects_caption_more_than_one_segment_behind(self):
        for name in ('high', 'medium', 'low'):
            self.write(name + '.m3u8', self.playlist(name + '.ts').replace('#EXT-X-ENDLIST', f'#EXTINF:2.000,\n{name}.ts\n#EXTINF:2.000,\n{name}.ts\n'))
        with self.assertRaises(ValidationError): self.check(live=True)
