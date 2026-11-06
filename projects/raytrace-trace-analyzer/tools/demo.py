"""Run the same animated scene through both traversal paths and keep reviewable artifacts."""
import argparse
import json
import subprocess
from pathlib import Path
from tools.analyze import load_trace, write_report
from tools.render_diff import image_diff


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer', type=Path, default=Path('build/raytrace'))
    parser.add_argument('--output', type=Path, default=Path('runs/demo'))
    args = parser.parse_args()
    if args.output.exists():
        parser.error('output exists; choose a new directory')
    for name, flags in [('bvh', []), ('brute', ['--brute-force']), ('no-shadows', ['--no-shadows'])]:
        subprocess.run([str(args.renderer.resolve()), '--width', '320', '--height', '180', '--frames', '6',
                        '--output', str(args.output/name), *flags], check=True)
    bvh, brute = [load_trace(args.output/name/'trace.json') for name in ('bvh', 'brute')]
    identical = [image_diff(args.output/'brute'/f'frame_{i:04d}.png', args.output/'bvh'/f'frame_{i:04d}.png',
                            args.output/f'diff_{i:04d}.png') for i in range(6)]
    if any(result['changed_pixels'] for result in identical):
        raise RuntimeError('BVH and reference images disagree')
    shadow = image_diff(args.output/'bvh/frame_0000.png', args.output/'no-shadows/frame_0000.png',
                        args.output/'shadow-diff.png')
    # Treat brute force as the candidate to demonstrate a real, measured regression.
    report = write_report(brute, bvh, args.output/'report.md')
    summary = {'identical_frames': len(identical), 'shadow_changed_pixels': shadow['changed_pixels'],
               'bvh_primitive_tests': sum(f['primitive_tests'] for f in bvh['frames']),
               'brute_primitive_tests': sum(f['primitive_tests'] for f in brute['frames']),
               'flagged_regressions': len(report['regressions'])}
    (args.output/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__': main()
