"""Rebuild public/playermap/map_clean.webp from the original labelled art (dev tool, not shipped).
   pip install simple-lama-inpainting   (LaMa big-lama TorchScript weights, Apache-2.0; downloaded on first run, not committed)
   python tools/map-clean/inpaint.py <alessandro_map_v1.png> public/playermap/map_clean.webp
Each baked label / title / button box (mask.py) is inpainted in its own crop with 96 px of context, then the tiny
"Café Yoo" writing on the café wall. Pixels outside the masks are left untouched (2 px feathered seam)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image, ImageDraw, ImageFilter
from simple_lama_inpainting import SimpleLama
from mask import BOXES

def clean(src: str, dst: str, ctx: int = 96):
  lama = SimpleLama(); out = Image.open(src).convert('RGB'); W, H = out.size
  def patch(box, poly):
    crop = out.crop(box); m = Image.new('L', crop.size, 0); ImageDraw.Draw(m).polygon(poly, fill=255) if len(poly) > 4 else ImageDraw.Draw(m).rounded_rectangle(poly, radius=18, fill=255)
    r = lama(crop, m).crop((0, 0, crop.width, crop.height))
    out.paste(Image.composite(r, crop, m.filter(ImageFilter.GaussianBlur(2))), box[:2])
  for (x0, y0, x1, y1) in BOXES.values():
    b = (max(0, x0 - ctx), max(0, y0 - ctx), min(W, x1 + ctx), min(H, y1 + ctx))
    patch(b, (x0 - 4 - b[0], y0 - 4 - b[1], x1 + 4 - b[0], y1 + 4 - b[1]))
  patch((510, 365, 595, 425), [(14, 13), (65, 28), (65, 49), (14, 35), (14, 13)])  # café wall writing
  out.save(dst, 'WEBP', quality=82, method=6) if dst.endswith('.webp') else out.save(dst)

if __name__ == '__main__': clean(sys.argv[1], sys.argv[2])
