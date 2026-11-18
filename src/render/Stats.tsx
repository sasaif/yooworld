import { useFrame, useThree } from '@react-three/fiber';
/** Exposes renderer counters on window.__info (used by tools/shot.mjs for the perf table). */
export function Stats() {
  const { gl } = useThree(); let n = 0;
  useFrame(() => { if (++n % 30) return; const i = gl.info; (window as unknown as { __info: unknown }).__info = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length }; });
  return null;
}
