import * as THREE from 'three';
// Simple 2D occupancy grid + A* (8-neighbour) on the floor plane.
export class NavGrid {
  cell: number; nx: number; nz: number; blocked: Uint8Array;
  constructor(w: number, d: number, cell = 0.2) { this.cell = cell; this.nx = Math.ceil(w / cell); this.nz = Math.ceil(d / cell); this.blocked = new Uint8Array(this.nx * this.nz); }
  idx(i: number, j: number) { return j * this.nx + i; }
  toCell(x: number, z: number): [number, number] { return [Math.min(this.nx - 1, Math.max(0, Math.floor(x / this.cell))), Math.min(this.nz - 1, Math.max(0, Math.floor(z / this.cell)))]; }
  center(i: number, j: number) { return new THREE.Vector3((i + 0.5) * this.cell, 0, (j + 0.5) * this.cell); }
  blockBox(minX: number, minZ: number, maxX: number, maxZ: number, pad = 0.12) {
    const [i0, j0] = this.toCell(minX - pad, minZ - pad), [i1, j1] = this.toCell(maxX + pad, maxZ + pad);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.blocked[this.idx(i, j)] = 1;
  }
  free(i: number, j: number) { return i >= 0 && j >= 0 && i < this.nx && j < this.nz && !this.blocked[this.idx(i, j)]; }
  nearestFree(i: number, j: number): [number, number] {
    if (this.free(i, j)) return [i, j];
    for (let r = 1; r < 30; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.max(Math.abs(di), Math.abs(dj)) === r && this.free(i + di, j + dj)) return [i + di, j + dj];
    return [i, j];
  }
  lineFree(a: THREE.Vector3, b: THREE.Vector3) {
    const n = Math.ceil(a.distanceTo(b) / (this.cell * 0.5));
    for (let k = 0; k <= n; k++) { const p = a.clone().lerp(b, k / Math.max(1, n)); const [i, j] = this.toCell(p.x, p.z); if (!this.free(i, j)) return false; }
    return true;
  }
  path(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const [si, sj] = this.nearestFree(...this.toCell(from.x, from.z)); const [ti, tj] = this.nearestFree(...this.toCell(to.x, to.z));
    const N = this.nx * this.nz, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const s = this.idx(si, sj), t = this.idx(ti, tj); g[s] = 0;
    const open: number[] = [s]; const h = (k: number) => Math.hypot((k % this.nx) - ti, Math.floor(k / this.nx) - tj);
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
      const cur = open.splice(bi, 1)[0]; if (cur === t) break; if (closed[cur]) continue; closed[cur] = 1;
      const ci = cur % this.nx, cj = Math.floor(cur / this.nx);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (!this.free(ni, nj)) continue;
        if (di && dj && (!this.free(ci + di, cj) || !this.free(ci, cj + dj))) continue;
        const nk = this.idx(ni, nj), ng = g[cur] + (di && dj ? Math.SQRT2 : 1);
        if (ng < g[nk]) { g[nk] = ng; came[nk] = cur; open.push(nk); }
      }
    }
    if (came[t] === -1 && t !== s) return [];
    const cells: THREE.Vector3[] = []; for (let k = t; k !== -1; k = came[k]) cells.unshift(this.center(k % this.nx, Math.floor(k / this.nx)));
    const end = this.free(...this.toCell(to.x, to.z)) ? to.clone().setY(0) : cells[cells.length - 1];
    cells[cells.length - 1] = end;
    // string-pulling
    const out: THREE.Vector3[] = []; let anchor = from.clone().setY(0);
    for (let k = 0; k < cells.length; k++) { const nxt = cells[k + 1]; if (!nxt || !this.lineFree(anchor, nxt)) { out.push(cells[k]); anchor = cells[k]; } }
    return out;
  }
}
