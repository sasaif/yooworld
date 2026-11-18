"""Seat pose checks from tools/pose-probe.mjs output (bones.json): avatar vertices vs the real furniture mesh.
usage: python3 tools/pose_check.py /tmp/pp/bones.json   -> table + JSON (pelvis vs seat top, knee angle, feet, penetration)"""
import json, math, sys, numpy as np
sys.path.insert(0, 'tools'); from seat_heights import load
SEAT_H = {'loungeSofa': 0.276, 'loungeChair': 0.276, 'chair': 0.288, 'chairDesk': 0.28, 'stoolBar': 0.522, 'bedDouble': 0.3}
def inside(T, P):
    """count of mesh hits above each point (parity => inside), and vertical depth to the nearest surface"""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]; above = np.zeros(len(P), int); dmin = np.full(len(P), np.inf)
    for k in range(0, len(T), 256):
        A, B, C = a[k:k+256, None], b[k:k+256, None], c[k:k+256, None]
        v0 = C[..., [0, 2]] - A[..., [0, 2]]; v1 = B[..., [0, 2]] - A[..., [0, 2]]; v2 = P[None, :, [0, 2]] - A[..., [0, 2]]
        d00 = (v0 * v0).sum(-1); d01 = (v0 * v1).sum(-1); d11 = (v1 * v1).sum(-1); d20 = (v2 * v0).sum(-1); d21 = (v2 * v1).sum(-1); den = d00 * d11 - d01 * d01
        with np.errstate(divide='ignore', invalid='ignore'):
            u = (d11 * d20 - d01 * d21) / den; v = (d00 * d21 - d01 * d20) / den
        hit = (np.abs(den) > 1e-12) & (u >= 0) & (v >= 0) & (u + v <= 1)
        y = A[..., 1] + u * (C[..., 1] - A[..., 1]) + v * (B[..., 1] - A[..., 1])
        dy = np.where(hit, y - P[None, :, 1], np.nan)
        above += np.nansum(np.where(hit & (dy > 0), 1, 0), 0)
        dmin = np.minimum(dmin, np.nanmin(np.where(hit, np.abs(dy), np.inf), 0))
    return above % 2 == 1, dmin
def ang(a, b, c):
    u = np.array(a) - np.array(b); w = np.array(c) - np.array(b); return math.degrees(math.acos(np.clip(u @ w / np.linalg.norm(u) / np.linalg.norm(w), -1, 1)))
r = json.load(open(sys.argv[1])); out = {}
for key, v in r.items():
    d = key.rsplit('_', 1)[0]; act = key.rsplit('_', 1)[1]; b = v['bones']; yaw = v['yaw']; P = np.array(v['verts']).reshape(-1, 3)
    T = load(d); sh = SEAT_H[d]
    # avatar -> item local frame (x right, z forward)
    dx = P[:, 0] - v['item']['x']; dz = P[:, 2] - v['item']['z']; L = np.c_[dx * math.cos(yaw) - dz * math.sin(yaw), P[:, 1], dx * math.sin(yaw) + dz * math.cos(yaw)]
    ins, depth = inside(T, L); deep = ins & (depth > 0.01)
    mn = T.reshape(-1, 3).min(0); mx = T.reshape(-1, 3).max(0)
    over = (L[:, 0] > mn[0]) & (L[:, 0] < mx[0]) & (L[:, 2] > mn[2]) & (L[:, 2] < mx[2]) & (L[:, 1] > sh - 0.1)
    res = {'pelvisAboveSeat': round(b['Hips'][1] - sh, 3), 'lowestOverSeat': round(float(L[over, 1].min()) - sh, 3) if over.any() else None,
           'inside>1cm': int(deep.sum()), 'maxDepth': round(float(depth[ins].max()), 3) if ins.any() else 0.0, 'verts': len(P)}
    if act == 'sit':
        res['kneeL'] = round(ang(b['LeftUpLeg'], b['LeftLeg'], b['LeftFoot'])); res['kneeR'] = round(ang(b['RightUpLeg'], b['RightLeg'], b['RightFoot']))
        res['hipFlexL'] = round(ang(b['Spine1'], b['LeftUpLeg'], b['LeftLeg']))
        res['feetY'] = round(min(b['LeftToeBase'][1], b['RightToeBase'][1]), 3); res['soleY'] = round(float(P[:, 1].min()), 3)
    else:
        res['kneeL'] = round(ang(b['LeftUpLeg'], b['LeftLeg'], b['LeftFoot']))
    out[key] = res; print(f'{key:18s}', json.dumps(res))
json.dump(out, open(sys.argv[1].replace('.json', '_check.json'), 'w'), indent=1)
