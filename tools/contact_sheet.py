"""Contact sheet of an interaction sequence captured by tools/seq-capture.mjs.
usage: python3 tools/contact_sheet.py <metrics.json> <scen> <frames_dir> <out.png> [N=12]
Picks N frames evenly across the transition window (from the turn to a few frames after standing up), labels each
with the game time, phase and progress, and writes a 4-column grid with the measured smoothness numbers as a caption."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
mj, scen, d, out = sys.argv[1:5]; N = int(sys.argv[5]) if len(sys.argv) > 5 else 12
M = json.load(open(mj))[scen]; S = M['samples']
have = sorted(int(f[1:5]) for f in os.listdir(d) if f.startswith('f'))
act = [s['f'] for s in S if s['phase'] != 'none']
a, b = max(act[0] - 8, have[0]), min(act[-1] + 14, have[-1])
win = [f for f in have if a <= f <= b]
pick = [win[round(i * (len(win) - 1) / (N - 1))] for i in range(N)]
ims = [Image.open(f"{d}/f{f:04d}.png").convert('RGB') for f in pick]
w, h = ims[0].size; cols = 4; rows = (N + cols - 1) // cols; cap = 54
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', max(14, w // 22))
small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 18)
sheet = Image.new('RGB', (w * cols, h * rows + cap), 'white'); dr = ImageDraw.Draw(sheet)
by = {s['f']: s for s in S}
for i, (f, im) in enumerate(zip(pick, ims)):
    x, y = (i % cols) * w, (i // cols) * h; sheet.paste(im, (x, y)); s = by[f]
    prog = f"lp {s['lp']:.2f}" if s['lp'] > 0 else f"sp {s['sp']:.2f}" if s['phase'] not in ('none', 'turn') else ''
    lab = f"t={(f - pick[0]) / 60:.2f}s {s['phase']} {prog}"
    dr.rectangle([x, y, x + w, y + font.size + 8], fill=(255, 255, 255)); dr.text((x + 6, y + 3), lab, fill=(40, 20, 60), font=font)
    dr.rectangle([x, y, x + w - 1, y + h - 1], outline=(200, 200, 210))
j = M['maxJumpCm']
dr.text((8, h * rows + 6), f"{scen} · max per-frame jump @60fps: root {j['root']} cm, hips {j['hips']} cm, head {j['head']} cm, yaw {j['yaw']}° · max vertex below seat surface inside footprint {M['maxPenCm']} cm", fill=(20, 20, 20), font=small)
dr.text((8, h * rows + 30), f"frames {pick[0]}–{pick[-1]} of {M['frames']} (1/60 s game time each) · phases {M['phaseFrames']}", fill=(90, 90, 90), font=small)
sheet.save(out); print(out, sheet.size)
