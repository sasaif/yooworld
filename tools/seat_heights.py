"""Measure the real sitting / lying surface height of seat furniture (Kenney GLBs, kit scale, centred like flattenModel).
Prints the top surface y (m) under sample points along the item's local axes (x = across, z = forward)."""
import json, struct, sys, numpy as np
S = 1.2
CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1)}
def q2m(q):
    x, y, z, w = q
    return np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
def local(nd):
    if 'matrix' in nd: return np.array(nd['matrix']).reshape(4, 4).T
    M = np.eye(4); M[:3, :3] = q2m(nd.get('rotation', [0, 0, 0, 1])) @ np.diag(nd.get('scale', [1, 1, 1])); M[:3, 3] = nd.get('translation', [0, 0, 0]); return M
def load(model):
    b = open(f'public/models/furniture/{model}.glb', 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + n])
    bin0 = 20 + n + 8; blob = b[bin0:]
    def acc(i):
        a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; fmt, sz = CT[a['componentType']]
        nc = {'SCALAR': 1, 'VEC3': 3, 'VEC2': 2, 'VEC4': 4}[a['type']]; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', sz * nc)
        return np.array([struct.unpack_from('<' + fmt * nc, blob, off + k * stride) for k in range(a['count'])])
    tris = []
    def walk(i, P):
        nd = j['nodes'][i]; M = P @ local(nd)
        if 'mesh' in nd:
            for pr in j['meshes'][nd['mesh']]['primitives']:
                V = acc(pr['attributes']['POSITION']); V = (M @ np.c_[V, np.ones(len(V))].T).T[:, :3]
                I = acc(pr['indices']).reshape(-1) if 'indices' in pr else np.arange(len(V))
                tris.append(V[I.reshape(-1, 3)])
        for c in nd.get('children', []): walk(c, M)
    for r in j['scenes'][0]['nodes']: walk(r, np.eye(4))
    T = np.concatenate(tris) * S; mn = T.reshape(-1, 3).min(0); mx = T.reshape(-1, 3).max(0); c = (mn + mx) / 2
    T[:, :, 0] -= c[0]; T[:, :, 2] -= c[2]; T[:, :, 1] -= mn[1]; return T
def top(T, x, z):
    best = None
    for t in T:
        a, b, c = t; v0 = c[[0, 2]] - a[[0, 2]]; v1 = b[[0, 2]] - a[[0, 2]]; v2 = np.array([x, z]) - a[[0, 2]]
        d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1; den = d00 * d11 - d01 * d01
        if abs(den) < 1e-12: continue
        u = (d11 * d20 - d01 * d21) / den; v = (d00 * d21 - d01 * d20) / den
        if u >= -1e-6 and v >= -1e-6 and u + v <= 1 + 1e-6:
            y = a[1] + u * (c[1] - a[1]) + v * (b[1] - a[1]); best = y if best is None else max(best, y)
    return best
if __name__ == '__main__':
    for m in sys.argv[1:] or ['loungeSofa', 'loungeDesignSofa', 'loungeSofaCorner', 'loungeChair', 'chair', 'chairDesk', 'stoolBar', 'bedDouble']:
        T = load(m); mn = T.reshape(-1, 3).min(0); mx = T.reshape(-1, 3).max(0)
        print(m, 'size', np.round(mx - mn, 3))
        for z in np.linspace(mn[2] + 0.02, mx[2] - 0.02, 7):
            print('  z=%+.2f' % z, ' '.join('%5s' % ('-' if (h := top(T, x, z)) is None else '%.3f' % h) for x in np.linspace(mn[0] + 0.03, mx[0] - 0.03, 7)))
