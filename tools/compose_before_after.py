"""Side-by-side before/after: python3 tools/compose_before_after.py out.png "title" before.png after.png [label_before label_after]"""
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, a, b = sys.argv[1:5]; la = sys.argv[5] if len(sys.argv) > 5 else 'AVANT'; lb = sys.argv[6] if len(sys.argv) > 6 else 'APRÈS'
A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
h = max(A.height, B.height); W = 1400; scale = (W / 2 - 30) / max(A.width, B.width)
A = A.resize((int(A.width * scale), int(A.height * scale))); B = B.resize((int(B.width * scale), int(B.height * scale)))
H = max(A.height, B.height) + 110
img = Image.new('RGB', (W, H), (250, 240, 246)); d = ImageDraw.Draw(img)
def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()
d.text((20, 14), title, fill=(42, 36, 64), font=font(26))
for i, (im, lab, col) in enumerate([(A, la, (179, 38, 30)), (B, lb, (20, 120, 70))]):
    x = 20 + i * (W // 2); img.paste(im, (x, 90)); d.rectangle([x, 56, x + 150, 84], fill=col); d.text((x + 10, 58), lab, fill=(255, 255, 255), font=font(20))
img.save(out); print(out, img.size)
