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
  def labels_mask(s, skip=()):
    m = Image.new('L', (s.W, s.H), 0)
    for n in BOXES:
      if n not in skip: s.capsule(n, d=m)
    return m
