"""Before/after grid: python3 tools/compose_grid.py out.png "title" "rowLabel|before.png|after.png[|extra.png]" ... (columns: AVANT, APRÈS, + optional 'APRÈS · de côté')"""
import sys
from PIL import Image, ImageDraw, ImageFont
def font(sz):
    for f in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        try: return ImageFont.truetype(f, sz)
        except OSError: pass
    return ImageFont.load_default()
out, title, rows = sys.argv[1], sys.argv[2], [r.split('|') for r in sys.argv[3:]]
ncol = max(len(r) - 1 for r in rows); CW, LW = 380, 170
def fit(p):
    im = Image.open(p).convert('RGB'); w, h = im.size
    if w / h > 1.9: im = im.crop((int(w / 2 - h * 0.75), 0, int(w / 2 + h * 0.75), h))
    return im.resize((CW, int(CW * im.size[1] / im.size[0])))
imgs = [[fit(p) for p in r[1:]] for r in rows]; RH = [max(i.size[1] for i in r) for r in imgs]
W = LW + ncol * (CW + 12) + 10; H = 100 + sum(h + 14 for h in RH)
img = Image.new('RGB', (W, H), (250, 240, 246)); d = ImageDraw.Draw(img); d.text((14, 14), title, fill=(42, 36, 64), font=font(22))
labs = [('AVANT', (179, 38, 30)), ('APRÈS', (20, 120, 70)), ('APRÈS · de côté', (20, 120, 70))]
for c in range(ncol): x = LW + c * (CW + 12); d.rectangle([x, 56, x + 190, 84], fill=labs[c][1]); d.text((x + 8, 59), labs[c][0], fill='white', font=font(18))
y = 96
for r, ims, h in zip(rows, imgs, RH):
    d.text((14, y + h // 2 - 10), r[0], fill=(42, 36, 64), font=font(17))
    for c, im in enumerate(ims): img.paste(im, (LW + c * (CW + 12), y))
    y += h + 14
img.save(out); print(out, img.size)
