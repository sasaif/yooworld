/** Render quality preset, chosen once at startup (override with ?q=low|high). */
export type Quality = 'low' | 'high';
const forced = new URLSearchParams(location.search).get('q') as Quality | null;
const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const QUALITY: Quality = forced ?? (coarse || Math.min(innerWidth, innerHeight) < 600 ? 'low' : 'high');
export const Q = {
  low: { dpr: [1, 1.5] as [number, number], shadowMap: 1024, antialias: true, pointLights: 2 },
  high: { dpr: [1, 2] as [number, number], shadowMap: 2048, antialias: true, pointLights: 4 },
}[QUALITY];
