"""Compare decoded RGB pixels; save a magenta overlay of changed pixels."""
import argparse
import json
from pathlib import Path
from PIL import Image


def image_diff(reference, current, output, threshold=0):
    if type(threshold) is not int or not 0 <= threshold <= 255:
        raise ValueError('threshold must be an integer from 0 to 255')
    reference, current, output = map(Path, (reference, current, output))
    if any(output.resolve() == source.resolve() or (output.exists() and output.samefile(source))
           for source in (reference, current)):
        raise ValueError('heatmap must not overwrite an input image')
    with Image.open(reference) as a, Image.open(current) as b:
        if a.size != b.size:
            raise ValueError(f'image sizes differ: {a.size} and {b.size}')
        a, b = a.convert('RGB'), b.convert('RGB')
    heat = Image.new('RGB', a.size)
    total, maximum, changed = 0, 0, 0
    pixels = []
    for left, right in zip(a.get_flattened_data() if hasattr(a, 'get_flattened_data') else a.getdata(),
                           b.get_flattened_data() if hasattr(b, 'get_flattened_data') else b.getdata()):
        errors = [abs(x-y) for x,y in zip(left,right)]
        error = max(errors); total += sum(errors); maximum = max(maximum,error)
        if error > threshold:
            changed += 1; pixels.append((255,0,255))
        else:
            gray = sum(right)//6; pixels.append((gray,gray,gray))
    heat.putdata(pixels)
    output.parent.mkdir(parents=True, exist_ok=True)
    heat.save(output)
    count = a.width*a.height
    return {'changed_pixels': changed, 'total_pixels': count, 'changed_percent': 100*changed/count,
            'mae': total/(3*count), 'max_channel_error': maximum, 'threshold': threshold}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path); parser.add_argument('current', type=Path)
    parser.add_argument('--output', type=Path, default=Path('diff.png'))
    parser.add_argument('--threshold', type=int, default=0)
    args = parser.parse_args()
    try:
        result = image_diff(args.reference, args.current, args.output, args.threshold)
    except (ValueError, OSError) as exc:
        parser.exit(2, f'error: {exc}\n')
    print(json.dumps(result, indent=2))
    return int(result['changed_pixels'] > 0)


if __name__ == '__main__':
    raise SystemExit(main())
