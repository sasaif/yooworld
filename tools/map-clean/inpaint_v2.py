"""v2 touch-up of public/playermap/map_clean.webp (dev tool, not shipped; free/local only).
   python tools/map-clean/inpaint_v2.py public/playermap/map.webp public/playermap/map_clean.webp OUT.png
v1 (inpaint.py) filled every label box with one LaMa pass, which smeared where a label covered structure (roofs, flags).
v2 redoes those areas from the ORIGINAL art: tight capsule masks, LaMa only for organic background (grass, paving,
trees, sky) with neighbouring labels masked out of the context, then the structure is redrawn by hand in the map's own
style (flat colours sampled from the art, dark outline, light top edge), or cloned from a clean part of the original."""
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter, ImageChops
from mask import BOXES
SS = 4  # supersampling for hand-drawn shapes

class Art:
  def __init__(s, orig, v1):
    s.O = Image.open(orig).convert('RGB'); s.out = Image.open(v1).convert('RGB'); s.W, s.H = s.O.size; s._lama = None
  @property
  def lama(s):
    if s._lama is None:
      from simple_lama_inpainting import SimpleLama
      s._lama = SimpleLama()
    return s._lama
  def capsule(s, name, pad=3, shadow=4, d=None):
    x0, y0, x1, y1 = BOXES[name]; m = Image.new('L', (s.W, s.H), 0) if d is None else d
    r = min((y1 - y0) / 2 + pad, 30)
    ImageDraw.Draw(m).rounded_rectangle((x0 - pad, y0 - pad, x1 + pad, y1 + pad + shadow), radius=r, fill=255); return m
  def restore(s, box):  # bring back the original (labelled) pixels of an area before redoing it
    s.out.paste(s.O.crop(box), box[:2])
  def fill(s, mask, box, ctx_mask=None, feather=1.5):
    """LaMa on crop `box` of the current image; `mask` (full-size L) = pixels to fill.
       ctx_mask: extra pixels that are not trustworthy context (other labels) - filled too but only `mask` is kept."""
    crop = s.out.crop(box); m = mask.crop(box)
    mm = ImageChops.lighter(m, ctx_mask.crop(box)) if ctx_mask is not None else m
    r = s.lama(crop, mm).crop((0, 0, crop.width, crop.height))
    s.out.paste(Image.composite(r, crop, m.filter(ImageFilter.GaussianBlur(feather)) if feather else m), box[:2])
  def layer(s):  # transparent full-size supersampled drawing layer
    L = Image.new('RGBA', (s.W * SS, s.H * SS), (0, 0, 0, 0)); return L, ImageDraw.Draw(L)
  def put(s, L, clip=None):
    L = L.resize((s.W, s.H), Image.LANCZOS)
    if clip is not None: a = ImageChops.multiply(L.getchannel('A'), clip); L.putalpha(a)
    s.out.paste(L, (0, 0), L)
  def poly(s, d, pts, fill, outline=None, w=0):
    P = [(x * SS, y * SS) for x, y in pts]; d.polygon(P, fill=fill)
    if outline: d.line(P + [P[0]], fill=outline, width=int(w * SS), joint='curve')
  def line(s, d, pts, fill, w):
    d.line([(x * SS, y * SS) for x, y in pts], fill=fill, width=int(w * SS), joint='curve')
  def ellipse(s, d, box, fill, outline=None, w=0):
    d.ellipse([v * SS for v in box], fill=fill, outline=outline, width=int(w * SS))
  def grain(s, box, amt=2.0, seed=0):  # tiny noise so flat paint matches the art's texture
    a = np.array(s.out.crop(box)).astype(np.float32); a += np.random.default_rng(seed).normal(0, amt, a.shape)
    s.out.paste(Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), box[:2])
  def paint(s, pts, top, bottom, light=0.14, ao=0.28, outline=(60, 28, 18), ow=1.4, tex=7.0, grain=2.2, seed=0,
            lines=None, line_col=None, line_alpha=0.35, highlight=None):
    """Painted surface in the map's style (not a flat fill): vertical colour gradient (top -> bottom), light from the
       upper left, soft ambient occlusion towards the edges, low-frequency paint texture + fine grain, optional soft
       detail lines (shingles / planks), a light rim along the front edge, and a slightly soft dark outline."""
    import cv2
    m = Image.new('L', (s.W * SS, s.H * SS), 0); ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in pts], fill=255)
    A = np.array(m.resize((s.W, s.H), Image.LANCZOS)).astype(np.float32) / 255
    ys, xs = np.nonzero(A > 0.01); y0, y1, x0, x1 = ys.min() - 3, ys.max() + 4, xs.min() - 3, xs.max() + 4
    a = A[y0:y1, x0:x1]; h, w = a.shape
    t = np.clip((np.arange(h)[:, None] - 3) / max(1, h - 7), 0, 1); u = np.clip((np.arange(w)[None, :] - 3) / max(1, w - 7), 0, 1)
    col = np.array(top, np.float32) * (1 - t[..., None]) + np.array(bottom, np.float32) * t[..., None]
    col = col * (1 + light * (0.5 - u))[..., None] * (1 + light * 0.5 * (0.5 - t))[..., None]
    inner = cv2.GaussianBlur(a, (0, 0), 2.2); col *= (1 - ao * np.clip(1 - inner, 0, 1) * (a > 0))[..., None]
    rng = np.random.default_rng(seed)
    lo = cv2.GaussianBlur(rng.normal(0, 1, (h, w)).astype(np.float32), (0, 0), 2.6); lo /= (lo.std() + 1e-6)
    col += (lo * tex)[..., None] + rng.normal(0, grain, (h, w, 3))
    if lines:
      L = Image.new('L', (w * SS, h * SS), 0); d = ImageDraw.Draw(L)
      for seg in lines: d.line([((x - x0) * SS, (y - y0) * SS) for x, y in seg], fill=255, width=int(0.9 * SS))
      la = cv2.GaussianBlur(np.array(L.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255, (0, 0), 0.45) * line_alpha
      lc = np.array(line_col or [v * 0.62 for v in bottom], np.float32)
      col = col * (1 - la[..., None]) + lc * la[..., None]
    if highlight:  # light rim (e.g. the front edge catching the light)
      H = Image.new('L', (w * SS, h * SS), 0); ImageDraw.Draw(H).line([((x - x0) * SS, (y - y0) * SS) for x, y in highlight], fill=255, width=int(1.3 * SS))
      ha = cv2.GaussianBlur(np.array(H.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255, (0, 0), 0.5) * 0.75
      col = col * (1 - ha[..., None]) + np.minimum(255, np.array(bottom, np.float32) * 1.35 + 30) * ha[..., None]
    if outline is not None and ow:
      O = Image.new('L', (w * SS, h * SS), 0); P = [((x - x0) * SS, (y - y0) * SS) for x, y in pts]
      ImageDraw.Draw(O).line(P + [P[0]], fill=255, width=int(ow * SS), joint='curve')
      oa = cv2.GaussianBlur(np.array(O.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255, (0, 0), 0.4)
      col = col * (1 - oa[..., None]) + np.array(outline, np.float32) * oa[..., None]; a = np.maximum(a, oa)
    base = np.array(s.out.crop((x0, y0, x1, y1))).astype(np.float32)
    res = base * (1 - a[..., None]) + np.clip(col, 0, 255) * a[..., None]
    s.out.paste(Image.fromarray(np.clip(res, 0, 255).astype(np.uint8)), (int(x0), int(y0)))
  def glow(s, pts, color, w=1.6, blur=2.5, strength=0.8):  # neon line with a soft halo
    import cv2
    m = Image.new('L', (s.W * SS, s.H * SS), 0); ImageDraw.Draw(m).line([(x * SS, y * SS) for x, y in pts], fill=255, width=int(w * SS))
    a = np.array(m.resize((s.W, s.H), Image.LANCZOS)).astype(np.float32) / 255
    halo = cv2.GaussianBlur(a, (0, 0), blur) * strength
    o = np.array(s.out).astype(np.float32); c = np.array(color, np.float32)
    o = o + (c - o) * halo[..., None] * 0.55; o = o * (1 - a[..., None]) + np.minimum(255, c * 0.6 + 110) * a[..., None]
    s.out = Image.fromarray(np.clip(o, 0, 255).astype(np.uint8))
  def labels_mask(s, skip=()):
    m = Image.new('L', (s.W, s.H), 0)
    for n in BOXES:
      if n not in skip: s.capsule(n, d=m)
    return m
