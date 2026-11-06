import unittest
from stream.packager import command


class PackagerTests(unittest.TestCase):
    def test_ladder_is_three_resolutions_with_two_second_keyframes(self):
        args = command('rtmp://ingest/live/demo', '/captions.vtt', '/output')
        self.assertIn('1280:720', ' '.join(args))
        self.assertIn('854:480', ' '.join(args))
        self.assertIn('640:360', ' '.join(args))
        self.assertEqual(args[args.index('-g') + 1], '48')
        self.assertEqual(args[args.index('-hls_time') + 1], '2')
        self.assertIn('mpegts_copyts=1', args)

    def test_single_subtitle_group_is_shared_without_muxer_crash(self):
        args = command('rtmp://ingest/live/demo', '/captions.vtt', '/output')
        mapping = args[args.index('-var_stream_map') + 1]
        self.assertEqual(mapping.count('sgroup:subs'), 1)
        self.assertEqual(len(mapping.split()), 3)
        self.assertIn('s:0', mapping)

    def test_event_output_retains_segments_and_writes_atomically(self):
        args = command('rtmp://ingest/live/demo', '/captions.vtt', '/output')
        self.assertIn('independent_segments+temp_file', args)
        self.assertEqual(args[args.index('-hls_playlist_type') + 1], 'event')
        self.assertEqual(args[-1], '/output/%v.m3u8')
