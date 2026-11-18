"""Projected area (world units^2 on screen) of the room silhouette (same points as cameraFit.projectedRoomSize)."""
import numpy as np
def hull_area(P):
    P = sorted(map(tuple, P)); cross = lambda o, a, b: (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in P:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(P):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    H = lo[:-1] + up[:-1]; return 0.5 * abs(sum(H[i][0]*H[(i+1) % len(H)][1] - H[(i+1) % len(H)][0]*H[i][1] for i in range(len(H))))
def area(w=7.2, d=6.0, h=1.55, dirv=(1, 1.05, 1.2)):
    back = np.array(dirv, float); back /= np.linalg.norm(back)
    right = np.cross([0, 1, 0], back); right /= np.linalg.norm(right); up = np.cross(back, right)
    pts = [(0,0,0),(w,0,0),(0,0,d),(w,0,d),(0,h,0),(w,h,0),(0,h,d)]
    return hull_area([[np.dot(p, right), np.dot(p, up)] for p in pts])
if __name__ == '__main__': print(area())
