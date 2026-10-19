"""Original geometric demo assets. Run with Python and Pillow (MIT-CMU).

No system fonts, photos, external art or embedded font programs are used.
The PDF uses the viewer's standard Helvetica font.
"""
from pathlib import Path
from PIL import Image, ImageDraw

public = Path(__file__).resolve().parents[1] / 'public'
landscape = Image.new('RGB', (640, 360), '#a8e0e7')
draw = ImageDraw.Draw(landscape)
draw.ellipse((460, 36, 530, 106), fill='#ffe1a1')
draw.polygon([(0, 230), (160, 100), (330, 260)], fill='#608e91')
draw.polygon([(190, 260), (395, 130), (640, 250), (640, 360), (0, 360)], fill='#326c70')
draw.polygon([(0, 290), (215, 265), (470, 295), (640, 265), (640, 360), (0, 360)], fill='#2396a1')
landscape.save(public / 'demo-landscape.jpg', quality=92)
icons = public / 'icons'
icons.mkdir(exist_ok=True)
for name, size in [('favicon', 32), ('apple-touch-icon', 180), ('icon-192', 192), ('icon-512', 512), ('maskable-512', 512)]:
    image = Image.new('RGB', (size, size), '#163c43')
    d = ImageDraw.Draw(image)
    d.rounded_rectangle((size*.26, size*.22, size*.4, size*.76), radius=size*.04, fill='#9fe0d2')
    d.rounded_rectangle((size*.26, size*.64, size*.74, size*.78), radius=size*.04, fill='#9fe0d2')
    d.ellipse((size*.56, size*.22, size*.74, size*.4), fill='#ffd48b')
    image.save(icons / (name+'.png'))

slides = [
    ('Feedback loops', ['A system contains interacting parts.', 'Inputs influence a process; the process produces outputs.', 'Feedback returns information about the output to influence a later input.']),
    ('Two useful patterns', ['Negative feedback reduces a deviation: consider a thermostat.', 'Positive feedback amplifies change: consider a snowball effect.', 'Try drawing one input, one output and a return arrow.']),
]
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>', b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
def text(x, y, size, value):
    escaped = value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    return f'BT /F1 {size} Tf {x} {y} Td ({escaped}) Tj ET\n'
for index, (title, lines) in enumerate(slides):
    content = '0.06 0.16 0.22 rg 0 0 960 540 re f\n0.94 0.98 0.98 rg\n'
    content += text(60, 435, 36, title)
    for i, line in enumerate(lines):
        content += text(60, 335-i*62, 21, line)
    content += text(60, 48, 15, 'Authored fictional teaching material - LifeOS demo')
    data = content.encode('ascii')
    objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents {5+index*2} 0 R >>'.encode(), f'<< /Length {len(data)} >>\nstream\n'.encode()+data+b'endstream']
pdf = bytearray(b'%PDF-1.4\n')
offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf += f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
xref = len(pdf)
pdf += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
for offset in offsets[1:]:
    pdf += f'{offset:010d} 00000 n \n'.encode()
pdf += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(public / 'demo-slides.pdf').write_bytes(pdf)
