"""Compose the hair-motion integration deliverables from tools/capture-hair-motion.mjs frames + perf JSON.
usage: python3 tools/compose_hair_integration.py FRAMES_DIR PERF_JSON OUT_DIR
 - OUT/hair_motion_ingame.webm : per case, static (left) vs spring (right), phase + max hair angle labels
 - OUT/hair_motion_integration_board.png (+ _preview.jpg < 2 MB): key frames per case + emulated perf table
"""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
FR, PERF, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(OUT, exist_ok=True)
meta = json.load(open(os.path.join(FR, 'meta.json')))
NAMES = {'buns': 'Juanita - chignons roses (défaut)', 'long': 'Cheveux longs', 'long_cap': 'Cheveux longs + casquette',
         'buns_cap': 'Chignons + casquette', 'long_phones': 'Cheveux longs + casque audio'}
CASES = [c for c in NAMES if f'{c}_0' in meta and f'{c}_1' in meta]
def font(s, bold=False):
    for p in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else []) + ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, s)
    return ImageFont.load_default()
F, FB, FS = font(26), font(30, True), font(20)
def frame(case, hm, i):
    return Image.open(os.path.join(FR, f'{case}_{hm}', f'f{i:04d}.jpg')).convert('RGB')
def pair(case, i, scale=1.0):
    a, b = frame(case, 0, i), frame(case, 1, i); w, h = a.size
    im = Image.new('RGB', (w * 2 + 12, h + 96), (18, 18, 24)); im.paste(a, (0, 96)); im.paste(b, (w + 12, 96))
    d = ImageDraw.Draw(im); ph0, ph1 = meta[f'{case}_0'][i], meta[f'{case}_1'][i]
    d.text((12, 8), NAMES[case], font=FB, fill=(255, 255, 255)); d.text((12, 52), f'{ph1[0]}', font=F, fill=(255, 210, 120))
    d.text((w - 330, 52), 'STATIQUE (actuel)', font=F, fill=(200, 200, 200)); d.text((w * 2 + 12 - 420, 52), f'RESSORT  {ph1[1]:.1f}°', font=F, fill=(120, 230, 160))
    if scale != 1.0: im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    return im
# --- video
vd = os.path.join(FR, '_video'); os.makedirs(vd, exist_ok=True); k = 0
for c in CASES:
    n = min(len(meta[f'{c}_0']), len(meta[f'{c}_1']))
    for i in range(n):
        pair(c, i, 0.8).save(os.path.join(vd, f'v{k:05d}.png')); k += 1
webm = os.path.join(OUT, 'hair_motion_ingame.webm')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '30', '-i', os.path.join(vd, 'v%05d.png'), '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
                '-c:v', 'libvpx-vp9', '-b:v', '1.2M', '-pix_fmt', 'yuv420p', webm], check=True)
# --- board: per case 3 key frames (walk peak, turn peak, settled at end) static|spring
rows = []
for c in CASES:
    m1 = meta[f'{c}_1']; idx = lambda lab: [i for i, x in enumerate(m1) if x[0] == lab]
    walk, turn, stop = idx('MARCHE'), idx('VIRAGE 90° (course)'), idx('ARRÊT → REPOS')
    picks = [max(walk, key=lambda i: m1[i][1]), max(turn, key=lambda i: m1[i][1]), stop[-1]]
    rows.append([pair(c, i, 0.5) for i in picks])
cw, ch = rows[0][0].size; perf = json.load(open(PERF))
lines = ['PERF — ÉMULATION (Chrome headless + SwiftShader sans GPU, throttle CPU SE 6x / iPhone 15 4x, machine partagée chargée). Pas un vrai iPhone.']
for g in perf['game']:
    lines.append(f"Jeu plage  {g['device']:<9} {g['hairMotion']:<6}  draw calls {g['drawCalls']:>3}  maj cheveux {g['hairUpdateMsPerFrame']['mean']:.3f} ms/img  rigs {g['rigsUpdated']}  avatar {g['avatarScreenH']['f']} px  pic {g['peakDeg']}°")
for r in perf['crowd']:
    lines.append(f"Foule {r['avatars']:>2} av.  {r['device']:<9} {r['hairMotion']:<17} draw calls {r['drawCalls']:>3}  driveHair {r['benchHairMsPerFrame']:.3f} ms/img  rigs/img {r['rigsUpdatedPerFrame']}  CPU img p50 {r['frameCpuMs']['p50']:.1f} ms")
lines.append('Images/s du jeu en émulation (2-3 i/s) limitées par SwiftShader + charge machine, identiques statique/ressort : non représentatives d’un iPhone.')
th = 60 + 30 * len(lines)
W = cw * 3 + 40; H = 120 + ch * len(rows) + 10 * len(rows) + th
bd = Image.new('RGB', (W, H), (12, 12, 16)); d = ImageDraw.Draw(bd)
d.text((20, 20), 'YooWorld — mouvement secondaire des cheveux, intégration en jeu (branche locale feature/hair-motion)', font=font(34, True), fill=(255, 255, 255))
d.text((20, 70), 'Caméra par défaut, plage, iPhone 15 paysage. Colonnes : pic marche | pic virage | après arrêt. Gauche = statique, droite = ressort.', font=F, fill=(190, 190, 200))
y = 120
for r in rows:
    for j, im in enumerate(r): bd.paste(im, (10 + j * (cw + 10), y))
    y += ch + 10
for i, l in enumerate(lines): d.text((20, y + 20 + 30 * i), l, font=FS if i else font(20, True), fill=(230, 230, 230) if i else (255, 200, 120))
png = os.path.join(OUT, 'hair_motion_integration_board.png'); bd.save(png, optimize=True)
q = 85; pv = bd.copy(); pv.thumbnail((2400, 2400)); jp = os.path.join(OUT, 'hair_motion_integration_board_preview.jpg')
while True:
    pv.save(jp, quality=q)
    if os.path.getsize(jp) < 1.9e6 or q < 40: break
    q -= 10
print('cases', CASES, 'video frames', k, 'board', bd.size, os.path.getsize(png), 'preview', os.path.getsize(jp))
