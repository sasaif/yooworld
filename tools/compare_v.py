"""Builds shots/compare-v/*.png: per-device V1|V2|V3 side-by-side (room view + Vue perso) and an overview grid."""
import json, sys
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, 'tools'); from room_area import area
D = 'shots/compare-v'; R = f'{D}/raw'
M = json.load(open(f'{R}/metrics.json')); C = json.load(open(f'{R}/coverage.json')); A = area()
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
DEV = {'iphone15_landscape': ('iPhone 15 paysage', 852, 393), 'pixel7_landscape': ('Pixel 7 paysage', 915, 412), 'ipad_landscape': ('iPad paysage', 1024, 768), 'desktop': ('Desktop 1440×900', 1440, 900)}
VN = {1: 'V1 actuelle', 2: 'V2 avatars +', 3: 'V3 caméra rapprochée'}
def stats(dev, v, view):
    k = f'{dev}_v{v}_{view}'; m = M[k]; _, w, h = DEV[dev]
    px = round((m['f']['screenH'] + m['m']['screenH']) / 2); cov = C[k]; vis = min(100.0, cov / 100 * w * h / (A * m['zoom'] ** 2) * 100)
    return dict(px=px, f=m['f']['screenH'], cov=cov, vis=round(vis), zoom=m['zoom'], feet=m['f']['fullyVisible'] and m['m']['fullyVisible'], worldH=m['f']['worldH'], errors=m['errors'])
def tile(dev, v, view, W):
    im = Image.open(f'{R}/{dev}_v{v}_{view}.png').convert('RGB'); im = im.resize((W, round(im.height * W / im.width)), Image.LANCZOS)
    s = stats(dev, v, view); bar = 54; out = Image.new('RGB', (W, im.height + bar), '#2b2140'); out.paste(im, (0, bar)); d = ImageDraw.Draw(out)
    f1 = ImageFont.truetype(FONT, 22); f2 = ImageFont.truetype(FONT, 17)
    t = VN[v] + (' · Vue perso' if view == 'avatar' else '')
    d.text((12, 4), t, font=f1, fill='#ffd6ea'); d.text((12, 30), f"avatar {s['px']} px · écran couvert {s['cov']} % · pièce visible {s['vis']} %", font=f2, fill='white')
    return out
def row(dev, view, W=760):
    ts = [tile(dev, v, view, W) for v in (1, 2, 3)]; h = max(t.height for t in ts); out = Image.new('RGB', (W * 3 + 16, h), '#1d162b')
    for i, t in enumerate(ts): out.paste(t, (i * (W + 8), 0))
    return out
def titled(img, title):
    f = ImageFont.truetype(FONT, 28); out = Image.new('RGB', (img.width, img.height + 50), '#1d162b'); out.paste(img, (0, 50)); ImageDraw.Draw(out).text((14, 10), title, font=f, fill='white'); return out
table = {}
for dev, (label, w, h) in DEV.items():
    a, b = row(dev, 'room'), row(dev, 'avatar'); out = Image.new('RGB', (a.width, a.height + b.height + 8), '#1d162b'); out.paste(a, (0, 0)); out.paste(b, (0, a.height + 8))
    titled(out, f'{label} — même appart, même lumière, même angle iso · haut : Vue appartement · bas : Vue perso (bouton loupe)').save(f'{D}/{dev}.png', optimize=True)
    table[dev] = {f'v{v}_{view}': stats(dev, v, view) for v in (1, 2, 3) for view in ('room', 'avatar')}
rows = [titled(row(dev, 'room', 620), DEV[dev][0]) for dev in DEV]
out = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 60), '#1d162b'); y = 60
ImageDraw.Draw(out).text((14, 12), 'YooWorld — V1 (≈75 px) · V2 (≈85 px) · V3 (caméra rapprochée) — Vue appartement', font=ImageFont.truetype(FONT, 32), fill='#ffd6ea')
for r in rows: out.paste(r, (0, y)); y += r.height
out.save(f'{D}/overview.png', optimize=True)
json.dump(table, open(f'{D}/numbers.json', 'w'), indent=1)
for dev, t in table.items():
    print(dev); [print(' ', k, s) for k, s in t.items()]
