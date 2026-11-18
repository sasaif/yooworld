"""Measure Kenney furniture GLBs (with node transforms) -> src/data/furnitureBounds.json (metres, kit scale applied)."""
import json, struct, glob, os, numpy as np
S = 1.2
def q2m(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def local(nd):
    M = np.eye(4)
    if 'matrix' in nd: return np.array(nd['matrix']).reshape(4, 4).T
    R = q2m(nd.get('rotation', [0, 0, 0, 1])); Sx = np.diag(nd.get('scale', [1, 1, 1]))
    M[:3, :3] = R @ Sx; M[:3, 3] = nd.get('translation', [0, 0, 0]); return M
out = {}
for p in sorted(glob.glob('public/models/furniture/*.glb')):
    b = open(p, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n])
    pts = []
    def walk(i, P):
        nd = j['nodes'][i]; M = P @ local(nd)
        if 'mesh' in nd:
            for pr in j['meshes'][nd['mesh']]['primitives']:
                a = j['accessors'][pr['attributes']['POSITION']]; mn, mx = a['min'], a['max']
                for cx in (mn[0], mx[0]):
                    for cy in (mn[1], mx[1]):
                        for cz in (mn[2], mx[2]): pts.append((M @ np.array([cx, cy, cz, 1]))[:3])
        for c in nd.get('children', []): walk(c, M)
    for r in j['scenes'][0]['nodes']: walk(r, np.eye(4))
    P = np.array(pts) * S; mn, mx = P.min(0), P.max(0)
    out[os.path.basename(p)[:-4]] = {'w': round(float(mx[0] - mn[0]), 3), 'h': round(float(mx[1] - mn[1]), 3), 'd': round(float(mx[2] - mn[2]), 3)}
json.dump(out, open('src/data/furnitureBounds.json', 'w'), indent=1)
for k, v in out.items(): print(k, v)
