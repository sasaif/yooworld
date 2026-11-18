"""Room coverage (% of the screen that is not the pure-green probe background) for each *__probe.png."""
import sys, glob, json, os
from PIL import Image
import numpy as np
d = sys.argv[1] if len(sys.argv) > 1 else 'shots/compare-v/raw'
out = {}
for f in sorted(glob.glob(f'{d}/*__probe.png')):
    a = np.asarray(Image.open(f).convert('RGB')).astype(int)
    green = (a[..., 1] > 200) & (a[..., 0] < 60) & (a[..., 2] < 60)
    out[os.path.basename(f).replace('__probe.png', '')] = round(100 * (1 - green.mean()), 1)
json.dump(out, open(f'{d}/coverage.json', 'w'), indent=1); print(json.dumps(out, indent=1))
