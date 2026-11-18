"""Contact sheet of the joystick e2e screenshots: rows = devices, columns = scenes. usage: python3 tools/joystick_overview.py [shots_dir]"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
D = sys.argv[1] if len(sys.argv) > 1 else 'shots/movement'
devs = [('iphone15', 'iPhone 15 paysage'), ('pixel7', 'Pixel 7 paysage'), ('se', 'iPhone SE paysage'), ('ipad', 'iPad paysage')]
cols = [('walking', 'Marche (joystick)'), ('idle', 'Arrêt / relâché'), ('wall', 'Mur'), ('furniture', 'Meuble'), ('sitting', 'Assis'), ('beach', 'Yoo Plage')]
TW, LW, HH = 380, 190, 44
f = lambda s: ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', s) if os.path.exists('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf') else ImageFont.load_default()
rows = []
for k, label in devs:
    ims = [Image.open(f'{D}/{k}_{c}.png').convert('RGB') if os.path.exists(f'{D}/{k}_{c}.png') else None for c, _ in cols]
    h = max(int(TW * im.height / im.width) for im in ims if im)
    rep = json.load(open(f'{D}/report_{k}.json')) if os.path.exists(f'{D}/report_{k}.json') else None
    rows.append((label, ims, h, rep))
W = LW + TW * len(cols) + 8 * (len(cols) + 1); H = HH + sum(h + 8 for _, _, h, _ in rows) + 8
sheet = Image.new('RGB', (W, H), (36, 26, 44)); d = ImageDraw.Draw(sheet)
for i, (_, t) in enumerate(cols): d.text((LW + 8 + i * (TW + 8) + 6, 12), t, fill=(255, 225, 240), font=f(18))
y = HH
for label, ims, h, rep in rows:
    d.text((10, y + 8), label, fill='white', font=f(17))
    if rep:
        res = rep.get('results', []); n = sum(r['ok'] for r in res)
        d.text((10, y + 34), f"{n}/{len(res)} tests OK", fill=(140, 230, 160) if n == len(res) else (255, 150, 150), font=f(15))
        d.text((10, y + 56), f"{rep['viewport'][0]}×{rep['viewport'][1]} @{rep['dpr']}x", fill=(210, 200, 220), font=f(13))
        d.text((10, y + 76), f"max {rep['maxSpeed']} m/s", fill=(210, 200, 220), font=f(13))
    for i, im in enumerate(ims):
        x = LW + 8 + i * (TW + 8)
        if im: sheet.paste(im.resize((TW, int(TW * im.height / im.width)), Image.LANCZOS), (x, y))
        else: d.rectangle([x, y, x + TW, y + h], outline=(90, 80, 100))
    y += h + 8
sheet.save(f'{D}/overview.png', optimize=True); print(f'{D}/overview.png', sheet.size)
