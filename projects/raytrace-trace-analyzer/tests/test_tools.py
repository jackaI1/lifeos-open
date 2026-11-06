import json
import os
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from PIL import Image
from tools.analyze import load_trace, compare, write_report
from tools.render_diff import image_diff


def trace(times=(10, 30)):
    return {'schema_version': 1, 'scene': 'sphere-grid-v1', 'width': 16, 'height': 12,
            'frames': [{'frame': i, 'render_ms': t, 'build_ms': 1, 'encode_ms': 2,
                        'total_ms': t+3, 'primary_rays': 192, 'shadow_rays': 50,
                        'primitive_tests': 1000, 'box_tests': 100} for i, t in enumerate(times)]}


class AnalyzerTests(unittest.TestCase):
    def test_slow_and_matching_id_regressions(self):
        base, current = trace(), trace((15, 25))
        current['frames'].reverse()
        result = compare(current, base, budget_ms=20, regression_pct=20, min_delta_ms=2)
        self.assertEqual(result['slow_frames'], [1])
        self.assertEqual([r['frame'] for r in result['regressions']], [0])
        self.assertEqual(result['summary']['median_ms'], 20)

    def test_absolute_floor_suppresses_noise(self):
        self.assertEqual(compare(trace((1,)), trace((.1,)), min_delta_ms=2)['regressions'], [])

    def test_mismatched_workloads_rejected(self):
        for key, value in [('width', 20), ('scene', 'other')]:
            bad = trace(); bad[key] = value
            with self.assertRaises(ValueError): compare(bad, trace())
        with self.assertRaises(ValueError): compare(trace((1,)), trace())

    def test_validation_rejects_empty_duplicate_and_nonfinite(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'trace.json'
            variants = []
            empty = trace(); empty['frames'] = []; variants.append(empty)
            dup = trace(); dup['frames'][1]['frame'] = 0; variants.append(dup)
            for value in [-1, float('nan'), float('inf'), True, '10', 10**400]:
                bad = trace(); bad['frames'][0]['render_ms'] = value; variants.append(bad)
            bad = trace(); del bad['frames'][0]['primary_rays']; variants.append(bad)
            for bad in variants:
                path.write_text(json.dumps(bad))
                with self.assertRaises(ValueError): load_trace(path)
            path.write_text(json.dumps(trace()))
            self.assertEqual(len(load_trace(path)['frames']), 2)

    def test_report_does_not_destroy_trace_or_use_non_markdown_extension(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'trace.md'
            original = json.dumps(trace()); path.write_text(original)
            result = subprocess.run([sys.executable, '-m', 'tools.analyze', str(path), '--output', str(path)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(path.read_text(), original)
            with self.assertRaises(ValueError): write_report(trace(), None, Path(td)/'report.svg')
            for baseline, output in [('baseline.md', 'baseline.md'), ('sidecar.svg', 'sidecar.md')]:
                other = Path(td)/baseline; other.write_text(original)
                result = subprocess.run([sys.executable, '-m', 'tools.analyze', str(path),
                                        '--baseline', str(other), '--output', str(Path(td)/output)],
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(other.read_text(), original)

    def test_hardlinked_report_does_not_overwrite_trace(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'trace.json'; original = json.dumps(trace()); path.write_text(original)
            for name in ['report.md', 'report.svg']:
                linked = Path(td)/name; os.link(path, linked)
                result = subprocess.run([sys.executable, '-m', 'tools.analyze', str(path),
                                        '--output', str(Path(td)/'report.md')], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(path.read_text(), original)
                linked.unlink()

    def test_schema_version_requires_integer(self):
        bad = trace(); bad['schema_version'] = True
        with self.assertRaises(ValueError): compare(bad)

    def test_zero_baseline_and_report_plot(self):
        result = compare(trace((10,)), trace((0,)), min_delta_ms=1)
        self.assertIsNone(result['regressions'][0]['percent'])
        with tempfile.TemporaryDirectory() as td:
            report = Path(td)/'report.md'
            write_report(trace((10,)), trace((0,)), report, budget_ms=5)
            self.assertIn('Frame 0', report.read_text())
            self.assertTrue(report.with_suffix('.svg').exists())


class DiffTests(unittest.TestCase):
    def test_identical_and_changed_pixel_heatmap(self):
        with tempfile.TemporaryDirectory() as td:
            a,b,out = [Path(td)/name for name in ['a.png','b.png','heat.png']]
            image = Image.new('RGB',(4,3),(20,20,20)); image.save(a); image.save(b)
            self.assertEqual(image_diff(a,b,out)['changed_pixels'],0)
            image.putpixel((2,1),(120,20,20)); image.save(b)
            result = image_diff(a,b,out,threshold=10)
            self.assertEqual(result['changed_pixels'],1)
            self.assertAlmostEqual(result['mae'],100/36)
            with Image.open(out) as heat: self.assertEqual(heat.getpixel((2,1)),(255,0,255))
            self.assertEqual(image_diff(a,b,out,threshold=100)['changed_pixels'],0)

    def test_hardlinked_diff_does_not_overwrite_image(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td)/'input.png'; linked = Path(td)/'output.png'
            Image.new('RGB', (2,2), (1,2,3)).save(path)
            original = path.read_bytes(); os.link(path, linked)
            with self.assertRaises(ValueError): image_diff(path,path,linked)
            self.assertEqual(path.read_bytes(), original)

    def test_size_mismatch_and_invalid_threshold(self):
        with tempfile.TemporaryDirectory() as td:
            a,b,out = [Path(td)/name for name in ['a.png','b.png','heat.png']]
            Image.new('RGB',(2,2)).save(a); Image.new('RGB',(3,2)).save(b)
            with self.assertRaises(ValueError): image_diff(a,b,out)
            with self.assertRaises(ValueError): image_diff(a,a,out,threshold=-1)


if __name__ == '__main__': unittest.main()
