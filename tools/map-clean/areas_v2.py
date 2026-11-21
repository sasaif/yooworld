"""Per-area recipes for inpaint_v2.py (coordinates are full-res px of the 1672x941 art)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from inpaint_v2 import Art, SS

def club(a: Art):
  """Yoo Games Club: the label WAS the building's own roof sign -> keep the blue sign and the dice, erase only the
     lettering with the plate's own vertical colour profile, then add a row of marquee bulbs (no text)."""
  a.restore((936, 296, 1218, 388))
  O = np.array(a.O).astype(np.float32); out = np.array(a.out).astype(np.float32)
  prof = np.median(O[:, 1189:1193], axis=1); rng = np.random.default_rng(1)
  for y in range(326, 378):
    p = prof[y]
    if p[2] > 150 and p[0] < 70: out[y, 1013:1188] = p + rng.normal(0, 2.0, (175, 3))
  a.out = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
  L, d = a.layer()  # five arcade stars where the lettering was
  cols = [(255, 214, 72), (255, 122, 182), (110, 226, 255), (255, 122, 182), (255, 214, 72)]
  for i, c in enumerate(cols):
    cx, cy, R, r = 1046 + i * 33, 350, 9.0 if i == 2 else 7.5, 3.7 if i == 2 else 3.1
    pts = [(cx + (R if k % 2 == 0 else r) * np.sin(k * np.pi / 5), cy - (R if k % 2 == 0 else r) * np.cos(k * np.pi / 5)) for k in range(10)]
    a.ellipse(d, (cx - R - 3, cy - R - 3, cx + R + 3, cy + R + 3), c + (60,))
    a.poly(d, pts, c + (255,), (255, 255, 255, 255), 1.3)
  a.put(L)

FLAGS = [(244, 91, 156), (160, 82, 214), (74, 163, 239), (247, 165, 49), (239, 85, 96), (248, 213, 72)]
def _spline(pts, n=400):
  P = np.array(pts, float); t = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]; T = np.linspace(0, t[-1], n)
  from numpy import interp
  # Catmull-Rom through the points
  out = []
  Q = np.vstack([P[0], P, P[-1]])
  for i in range(len(P) - 1):
    p0, p1, p2, p3 = Q[i], Q[i + 1], Q[i + 2], Q[i + 3]
    for u in np.linspace(0, 1, 40, endpoint=False):
      out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
  out.append(P[-1]); return np.array(out)

def festivals(a: Art):
  """Festivals & Événements: LaMa repaves the plaza (all bunting masked out of the context), then the whole garland
     is redrawn as one sagging string of triangle flags between the two lamps."""
  a.restore((650, 462, 1024, 604))
  hole = a.capsule('festivals', pad=3, shadow=3)
  ctx = Image.new('L', (a.W, a.H), 0); dc = ImageDraw.Draw(ctx)
  dc.polygon([(699, 486), (732, 506), (730, 532), (699, 514)], fill=255)          # left bunting
  dc.polygon([(966, 484), (928, 504), (928, 534), (966, 520)], fill=255)          # right bunting
  dc.rectangle((736, 552, 924, 584), fill=255)                                     # bottom flags row
  dc.rectangle((798, 556, 813, 604), fill=0)                                       # keep the middle lamp
  full = ImageChops.lighter(hole, ctx)
  a.fill(full, (640, 430, 1032, 612), ctx_mask=a.labels_mask(skip=('festivals',)))
  ghost = Image.new('L', (a.W, a.H), 0); g = ImageDraw.Draw(ghost)   # LaMa grew two phantom posts: repave them
  for r in ((857, 510, 876, 557), (795, 532, 810, 557), (788, 510, 798, 544)): g.rectangle(r, fill=255)
  a.fill(ghost, (740, 470, 930, 600))
  path = _spline([(696, 496), (716, 512), (738, 538), (756, 553), (790, 559), (830, 561), (870, 559), (904, 553), (922, 538), (944, 512), (966, 496)])
  L, d = a.layer()
  a.line(d, [tuple(p) for p in path], (96, 70, 74, 255), 1.3)
  seg = np.r_[0, np.cumsum(np.hypot(*np.diff(path, axis=0).T))]
  k = 0
  for s in np.arange(9, seg[-1] - 6, 15.5):
    x, y = np.interp(s, seg, path[:, 0]), np.interp(s, seg, path[:, 1])
    c = FLAGS[k % len(FLAGS)]; k += 1; dk = tuple(int(v * .7) for v in c) + (255,)
    a.poly(d, [(x - 6, y), (x + 6, y), (x, y + 14)], c + (255,), dk, 0.9)
    a.line(d, [(x - 4.5, y + 1.2), (x + 1, y + 1.2)], (255, 255, 255, 120), 1.0)
  clip = Image.new('L', (a.W, a.H), 255); ImageDraw.Draw(clip).rectangle((799, 561, 812, 604), fill=0)   # lamp in front
  a.put(L, clip)
  L, d = a.layer()  # lamp cap that the label used to hide
  a.poly(d, [(799.5, 566), (811.5, 566), (809, 561), (802, 561)], (44, 46, 66, 255))
  a.ellipse(d, (803.5, 557.5, 807.5, 561.5), (44, 46, 66, 255))
  a.put(L)

def cafe(a: Art):
  """Café Yoo: LaMa rebuilds the background + the left wing's hip roof; the main block gets a hand-drawn flat
     terracotta roof with a light-wood rim and a text-free cream sign board with a little coffee cup."""
  v1 = a.out.crop((505, 360, 600, 428))
  a.restore((498, 296, 736, 424)); a.out.paste(v1, (505, 360))     # keep v1's cleaned wall writing
  hole = a.capsule('cafe', pad=3, shadow=4)
  ImageDraw.Draw(hole).rectangle((586, 368, 690, 384), fill=255)  # the cut "Café" lettering on the board
  a.fill(hole, (440, 250, 790, 440), ctx_mask=a.labels_mask(skip=('cafe',)))
  ink = (70, 30, 18)
  # painted wood facade with soft plank lines
  a.paint([(578, 357), (698, 357), (698, 383), (578, 383)], (150, 88, 52), (112, 60, 34), light=0.16, ao=0.3, outline=ink, ow=1.4,
          lines=[[(x, 358), (x, 382)] for x in (590, 602, 674, 686)], line_alpha=0.45, seed=11)
  # painted hip roof in the left wing's terracotta: darker at the ridge, lit from the left, soft shingle rows
  front, ridge = 357.5, 336.0; rows = []
  for k in range(1, 5):
    t = k / 5; y = ridge + t * (front - ridge); xl = 598 - t * 22; xr = 678 + t * 22; rows.append([(xl + 1, y), (xr - 1, y)])
    for x in np.arange(xl + 4 + (4 if k % 2 else 0), xr - 3, 8): rows.append([(x, y), (x, y + (front - ridge) / 5 - 0.8)])
  a.paint([(598, 336), (678, 336), (700, 358), (576, 358)], (112, 30, 20), (184, 72, 46), light=0.2, ao=0.3, outline=ink, ow=1.6,
          lines=rows, line_col=(92, 22, 14), line_alpha=0.5, highlight=[(578, 357), (698, 357)], seed=12)
  a.paint([(598, 334.8), (678, 334.8), (678, 337.6), (598, 337.6)], (206, 104, 72), (160, 66, 44), light=0.1, ao=0.1, outline=ink, ow=1.0, seed=13)
  # text-free sign board with a soft inner shadow, and the coffee cup
  a.paint([(614, 361), (664, 361), (664, 380), (614, 380)], (250, 234, 204), (226, 204, 166), light=0.1, ao=0.35, outline=ink, ow=1.4, tex=3, seed=14)
  L, d = a.layer()
  a.poly(d, [(632.5, 365.5), (645.5, 365.5), (644, 374.5), (634, 374.5)], (255, 255, 255, 255), ink + (255,), 1.1)
  a.ellipse(d, (643, 367, 649.5, 372.8), None, ink + (255,), 1.2)
  a.ellipse(d, (629, 373.8, 649, 377.2), (210, 146, 100, 255), ink + (255,), 0.9)
  a.ellipse(d, (633.5, 365.2, 644.5, 367.8), (120, 62, 36, 255))
  a.put(L)
  a.out.paste(a.out.crop((572, 332, 704, 386)).filter(ImageFilter.GaussianBlur(0.3)), (572, 332))

AREAS = {'club': club, 'festivals': festivals, 'cafe': cafe}

def depot(a: Art):
  """Dépôt livraisons: the left (beige) block lost its roof. Give it the same grey roof as its right-hand neighbour by
     a perspective clone of that roof's surviving face, plus the same white trim."""
  import cv2
  a.restore((1340, 398, 1574, 478)); m = a.capsule('depot', 3, 3)
  a.fill(m, (1270, 340, 1630, 500), ctx_mask=a.labels_mask(skip=('depot',)))
  src = np.float32([[1530, 456], [1596, 453], [1599, 468], [1534, 471]])
  dst = np.float32([[1404, 437], [1504, 437], [1510, 456], [1396, 456]])
  arr = cv2.warpPerspective(np.array(a.O), cv2.getPerspectiveTransform(src, dst), (a.W, a.H), flags=cv2.INTER_CUBIC)
  mk = Image.new('L', (a.W, a.H), 0); ImageDraw.Draw(mk).polygon([tuple(map(float, p)) for p in dst], fill=255)
  a.out.paste(Image.fromarray(arr), (0, 0), mk)
  L, d = a.layer(); trim = (232, 234, 240, 255); ink = (70, 66, 78, 255)
  a.line(d, [(1396, 456), (1404, 437), (1504, 437), (1510, 456)], trim, 2.2)
  a.line(d, [(1403.5, 435.6), (1504.5, 435.6)], ink, 1.0)
  a.line(d, [(1394, 457.5), (1512, 457.5)], trim, 2.6)
  a.line(d, [(1394, 459.6), (1512, 459.6)], (120, 104, 96, 255), 1.0)
  a.put(L)

def disco(a: Art):
  """Disco / Karaoké: flat purple roof with a neon-pink parapet (the facade's own colours) and two little spotlights."""
  a.restore((1188, 480, 1432, 561)); m = a.capsule('disco', 3, 4)
  a.fill(m, (1120, 425, 1495, 602), ctx_mask=a.labels_mask(skip=('disco',)))
  # the first pass left scraps from the old roof behind the new parapet; clean that narrow background too
  ghost = Image.new('L', (a.W, a.H), 0); gd = ImageDraw.Draw(ghost)
  gd.polygon([(1273, 518), (1293, 509), (1326, 511), (1349, 518), (1380, 519), (1407, 527), (1407, 536), (1271, 536)], fill=255)
  lay = a.out.copy()
  road = a.O.crop((1290, 484, 1418, 503)).resize((145, 30), Image.Resampling.BICUBIC)
  lay.paste(road, (1270, 506))
  a.out = Image.composite(lay, a.out, ghost.filter(ImageFilter.GaussianBlur(2)))
  ink = (46, 18, 86)
  # painted roof deck: dark at the back, lit from the left, with faint panel seams
  a.paint([(1226, 530), (1398, 530), (1410, 546), (1214, 546)], (58, 26, 108), (112, 56, 186), light=0.22, ao=0.32, outline=ink, ow=1.5,
          lines=[[(x, 531), (x - 2 + (x - 1312) * 0.07, 545)] for x in range(1244, 1400, 26)], line_col=(52, 22, 98), line_alpha=0.4, seed=21)
  # parapet: vertical gradient, light top rim, neon tube with a soft pink halo
  a.paint([(1212, 545), (1412, 545), (1412, 554.5), (1212, 554.5)], (150, 86, 232), (92, 40, 166), light=0.18, ao=0.25, outline=ink, ow=1.4,
          highlight=[(1214, 545.8), (1410, 545.8)], seed=22)
  a.glow([(1215, 548.6), (1409, 548.6)], (255, 120, 236), w=1.5, blur=2.6, strength=0.9)
  for x in (1250, 1374):  # two little rooftop spotlights
    a.paint([(x - 5, 534), (x + 5, 534), (x + 4, 541), (x - 4, 541)], (92, 94, 120), (48, 50, 70), light=0.25, ao=0.2, outline=ink, ow=1.0, tex=2, seed=x)
    a.glow([(x - 2.4, 535.6), (x + 2.4, 535.6)], (150, 240, 255), w=2.0, blur=2.0, strength=0.7)

def place(a: Art):
  """Place centrale: the label hid the plaza's north edge between two benches. Paving is cloned from the plaza just
     below (skipping the fountain jet, whose tip is kept), then LaMa rebuilds only the grass edge and bench tops."""
  a.restore((690, 262, 975, 345))
  spray = [(825, 333), (836, 333), (836, 340), (825, 340)]
  pav = a.O.copy()
  src = a.O.crop((760, 341, 905, 379)); pav.paste(src, (760, 303))
  pav.paste(a.O.crop((784, 341, 814, 379)), (814, 303)); pav.paste(a.O.crop((850, 341, 870, 379)), (838, 303))
  pm = Image.new('L', (a.W, a.H), 0); ImageDraw.Draw(pm).rectangle((762, 304, 903, 338), fill=255)
  ImageDraw.Draw(pm).polygon(spray, fill=0)
  a.out = Image.composite(pav, a.out, pm.filter(ImageFilter.GaussianBlur(1.5)))
  hole = a.capsule('place', 3, 3); d = ImageDraw.Draw(hole)
  d.rectangle((766, 309, 899, 340), fill=0); d.polygon(spray, fill=0)
  a.fill(hole, (640, 215, 1010, 380), ctx_mask=a.labels_mask(skip=('place',)))
  L, dd = a.layer()  # fountain jet tip that the label covered
  a.line(dd, [(830.5, 333), (830.5, 318)], (190, 232, 255, 220), 2.4)
  a.line(dd, [(830.5, 331), (830.5, 320)], (255, 255, 255, 255), 1.0)
  a.put(L)

def sky(a: Art):
  """Title + Quartier Résidentiel (top-left): v1 left a flat smeared sky band. Clone the untouched top-right of the
     same art (sky, clouds, snowy mountains, forest), mirrored, at 1:1 scale; then put back the real roof tops that
     the v1 rectangle had erased just under the old wooden sign."""
  v1 = a.out.copy()
  src = v1.crop((1130, 0, 1672, 128)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
  low = v1.crop((1130, 62, 1672, 112)).transpose(Image.Transpose.FLIP_LEFT_RIGHT)  # forest only (no factory / dome)
  m = Image.new('L', (a.W, a.H), 0)
  ImageDraw.Draw(m).rectangle((0, 0, 536, 100), fill=255)
  a.capsule('q_residentiel', 6, 5, d=m)
  # merge the two masks into one continuous forest band (no duplicated horizontal patch seam)
  ImageDraw.Draw(m).rectangle((190, 80, 494, 145), fill=255)
  lay = a.out.copy(); lay.paste(low, (0, 124)); lay.paste(src.crop((0, 0, 542, 122)), (0, 0))
  band = Image.new('L', (542, 14), 0); band.paste(Image.linear_gradient('L').rotate(180).resize((542, 14)), (0, 0))
  lay.paste(src.crop((0, 114, 542, 128)), (0, 114), band.point(lambda v: 255 - v))  # soft seam at y≈118-128
  a.out = Image.composite(lay, a.out, m.filter(ImageFilter.GaussianBlur(7)))
  seam = Image.new('L', (a.W, a.H), 0); ImageDraw.Draw(seam).rectangle((150, 113, 540, 133), fill=255)
  a.fill(seam, (110, 40, 600, 200), feather=3)  # thin LaMa band hides the stacking seam in the foliage
  rm = Image.new('L', (a.W, a.H), 0); d = ImageDraw.Draw(rm)
  d.polygon([(358, 163), (388, 156), (440, 156), (470, 168), (493, 175), (487, 193), (356, 193)], fill=255)
  d.polygon([(224, 174), (277, 167), (312, 182), (297, 195), (215, 196)], fill=255)
  a.out = Image.composite(a.O, a.out, rm.filter(ImageFilter.GaussianBlur(.6)))

def ponton(a: Art):
  # narrow second pass only on the ghosts, not the dock rope / foam / palm trunks
  m=Image.new('L',(a.W,a.H),0); d=ImageDraw.Draw(m)
  d.polygon([(1246,745),(1419,745),(1428,775),(1321,780),(1246,772)],fill=255)
  d.polygon([(1227,751),(1236,751),(1243,770),(1230,770)],fill=255)
  a.fill(m,(1160,691,1481,827))

AREAS.update({'depot':depot,'disco':disco,'place':place,'sky':sky,'ponton':ponton})
