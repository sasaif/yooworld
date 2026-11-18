"""Contact sheet of the movement step 2 e2e screenshots: rows = devices, columns = scenes.
usage: python3 tools/step2_overview.py [shots_dir] [prefix]   (prefix e.g. 'live_' for the run against GitHub Pages)"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1] if len(sys.argv) > 1 else 'shots/movement-step2'; P = sys.argv[2] if len(sys.argv) > 2 else ''
devs = [('iphone15', 'iPhone 15 paysage'), ('ipad', 'iPad paysage'), ('desktop', 'Ordinateur 1440×900')]
cols = [('settings_default', 'Réglages (défaut)'), ('settings_tap', 'Toucher pour aller activé'), ('marker', 'Repère de destination'), ('furniture_menu_on', 'Meuble : menu (mode ON)'), ('beach_marker', 'Yoo Plage')]
alt = {'desktop': {'settings_default': 'settings', 'settings_tap': None, 'furniture_menu_on': None}}
TW, LW, HH = 360, 190, 44
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
f = lambda s: ImageFont.truetype(FONT, s) if os.path.exists(FONT) else ImageFont.load_default()
rows = []
for k, label in devs:
    ims = []
    for c, _ in cols:
        name = alt.get(k, {}).get(c, c)
        path = f'{D}/{P}{k}_{name}.png' if name else None
        ims.append(Image.open(path).convert('RGB') if path and os.path.exists(path) else None)
    if not any(ims): continue
    h = max(int(TW * im.height / im.width) for im in ims if im)
    rp = f'{D}/{P}report_{k}.json'; rep = json.load(open(rp)) if os.path.exists(rp) else None
    rows.append((label, ims, h, rep))
W = LW + TW * len(cols) + 8 * (len(cols) + 1); H = HH + sum(h + 8 for _, _, h, _ in rows) + 8
sheet = Image.new('RGB', (W, H), (36, 26, 44)); d = ImageDraw.Draw(sheet)
for i, (_, t) in enumerate(cols): d.text((LW + 8 + i * (TW + 8) + 6, 12), t, fill=(255, 225, 240), font=f(17))
y = HH
for label, ims, h, rep in rows:
    d.text((10, y + 8), label, fill='white', font=f(17))
    if rep:
        res = rep.get('results', []); n = sum(r['ok'] for r in res); sk = len(rep.get('skipped', []))
        d.text((10, y + 34), f"{n}/{len(res)} tests OK", fill=(140, 230, 160) if n == len(res) else (255, 150, 150), font=f(15))
        if sk: d.text((10, y + 56), f"{sk} non testable ici", fill=(230, 210, 150), font=f(13))
        d.text((10, y + 76), 'en ligne' if 'github.io' in rep.get('url', '') else 'local', fill=(210, 200, 220), font=f(13))
    for i, im in enumerate(ims):
        x = LW + 8 + i * (TW + 8)
        if im: sheet.paste(im.resize((TW, int(TW * im.height / im.width)), Image.LANCZOS), (x, y))
        else: d.rectangle([x, y, x + TW, y + h], outline=(90, 80, 100)); d.text((x + 12, y + h // 2 - 8), '—', fill=(140, 130, 150), font=f(16))
    y += h + 8
out = f'{D}/{P}overview.png'; sheet.save(out, optimize=True); print(out, sheet.size)
