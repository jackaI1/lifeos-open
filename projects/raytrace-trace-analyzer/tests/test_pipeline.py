"""Black-box contract tests for the compiled renderer and both command-line tools."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from tools.analyze import load_trace
from tools.render_diff import image_diff

BINARY = Path(os.environ.get('RAYTRACE_BINARY', 'build/raytrace')).resolve()


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not BINARY.is_file():
            raise RuntimeError('Build the renderer first or set RAYTRACE_BINARY')

    def run_render(self, output, *args):
        return subprocess.run([str(BINARY), '--output', str(output), '--width', '64', '--height', '48',
                               '--frames', '2', *args], capture_output=True, text=True)

    def test_bvh_matches_reference_and_reduces_work(self):
        with tempfile.TemporaryDirectory() as td:
            fast, slow = Path(td)/'bvh', Path(td)/'brute'
            for path, args in [(fast, []), (slow, ['--brute-force'])]:
                result = self.run_render(path, *args)
                self.assertEqual(result.returncode, 0, result.stderr)
            a,b = load_trace(fast/'trace.json'), load_trace(slow/'trace.json')
            for f,g in zip(a['frames'],b['frames']):
                self.assertEqual(f['primary_rays'],64*48)
                self.assertGreater(f['shadow_rays'],0)
                self.assertGreater(f['box_tests'],0)
                self.assertEqual(g['box_tests'],0)
                self.assertLess(f['primitive_tests'],g['primitive_tests']/4)
                self.assertAlmostEqual(f['total_ms'],sum(f[k] for k in ['build_ms','render_ms','encode_ms']), delta=.000002)
                name = f"frame_{f['frame']:04d}.png"
                self.assertEqual(image_diff(slow/name,fast/name,Path(td)/'diff.png')['changed_pixels'],0)
            with Image.open(fast/'frame_0000.png') as image:
                self.assertGreater(len(set(image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata())),100)
            self.assertNotEqual((fast/'frame_0000.png').read_bytes(),(fast/'frame_0001.png').read_bytes())
            command = [sys.executable, '-m', 'tools.analyze', str(fast/'trace.json'),
                       '--baseline',str(slow/'trace.json'),'--output',str(Path(td)/'report.md'),'--budget-ms','100000']
            result = subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue((Path(td)/'report.svg').exists())

    def test_shadow_difference_and_cli_alert_exit(self):
        with tempfile.TemporaryDirectory() as td:
            a,b = Path(td)/'a',Path(td)/'b'
            self.assertEqual(self.run_render(a).returncode,0)
            self.assertEqual(self.run_render(b,'--no-shadows').returncode,0)
            cmd = [sys.executable,'-m','tools.render_diff',str(a/'frame_0000.png'),str(b/'frame_0000.png'),
                   '--output',str(Path(td)/'diff.png')]
            result = subprocess.run(cmd,capture_output=True,text=True)
            self.assertEqual(result.returncode,1,result.stderr)
            self.assertGreater(json.loads(result.stdout)['changed_pixels'],0)
            cmd = [sys.executable,'-m','tools.analyze',str(a/'trace.json'),'--budget-ms','0',
                   '--output',str(Path(td)/'report.md')]
            result = subprocess.run(cmd,capture_output=True,text=True)
            self.assertEqual(result.returncode,1,result.stderr)

    def test_invalid_cli_and_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td)/'run'
            for args in [('--width','0'),('--frames','-1'),('--width','4junk'),('--unknown',),('--height',)]:
                self.assertNotEqual(self.run_render(out,*args).returncode,0)
                self.assertFalse(out.exists())
            out.mkdir(); marker=out/'mine'; marker.write_text('keep')
            self.assertNotEqual(self.run_render(out).returncode,0)
            self.assertEqual(marker.read_text(),'keep')


if __name__ == '__main__': unittest.main()
