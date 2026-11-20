"""Hi-res variant of the clean map for level-2 zoom on high-DPR phones (dev tool, not shipped; free/local only).
   pip install spandrel ; weights: RealESRGAN_x4plus_anime_6B.pth (BSD-3, github.com/xinntao/Real-ESRGAN releases)
   python tools/map-clean/upscale.py WEIGHTS.pth in.png public/playermap/map_clean@2x.webp
Real-ESRGAN anime x4 on CPU in overlapping tiles, then Lanczos down to exactly 2x (3344x1882) - sharper and with
fewer hallucinations than a native x2 pass on this flat cartoon art."""
import sys, numpy as np, torch
from PIL import Image
from spandrel import ModelLoader
torch.set_num_threads(max(1, torch.get_num_threads()))
model = ModelLoader().load_from_file(sys.argv[1]).model.eval()
img = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(np.float32) / 255
H, W, _ = img.shape; S = 4; T, P = 160, 16
out = np.zeros((H * S, W * S, 3), np.float32)
with torch.inference_mode():
  for y in range(0, H, T):
    for x in range(0, W, T):
      y0, x0, y1, x1 = max(0, y - P), max(0, x - P), min(H, y + T + P), min(W, x + T + P)
      t = torch.from_numpy(img[y0:y1, x0:x1].transpose(2, 0, 1)).unsqueeze(0)
      r = model(t)[0].clamp(0, 1).numpy().transpose(1, 2, 0)
      oy, ox = (y - y0) * S, (x - x0) * S; h, w = (min(y + T, H) - y) * S, (min(x + T, W) - x) * S
      out[y * S:y * S + h, x * S:x * S + w] = r[oy:oy + h, ox:ox + w]
    print('row', y, flush=True)
big = Image.fromarray((out * 255 + .5).astype(np.uint8)).resize((W * 2, H * 2), Image.LANCZOS)
dst = sys.argv[3]
big.save(dst, 'WEBP', quality=int(sys.argv[4]) if len(sys.argv) > 4 else 78, method=6) if dst.endswith('.webp') else big.save(dst)
