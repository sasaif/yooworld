import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * Subtle life in the apartment (world immersion, mobile-friendly):
 *  - dust motes drifting in the window sunbeams: ONE Points draw call, animated entirely in the vertex shader
 *    (the CPU only writes one time uniform per frame, no per-frame allocation);
 *  - the sunbeams on the floor breathe very slowly (one opacity write on the existing beam material, see Decor).
 * Static, non-interactive (raycast disabled), disposed on unmount.
 */
const MOTES = 42;
const VERT = /* glsl */ `
uniform float uTime; uniform float uPx; attribute float aPhase; varying float vA;
void main() {
  vec3 p = position; float t = uTime * 0.25 + aPhase * 6.2831;
  p.x += sin(t * 0.9) * 0.06; p.z += cos(t * 0.7) * 0.06; p.y += sin(t * 0.5 + aPhase * 3.0) * 0.12;
  vA = 0.25 + 0.55 * (0.5 + 0.5 * sin(t * 1.7 + aPhase * 11.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * (1.4 + aPhase * 1.6);
}`;
const FRAG = /* glsl */ `
varying float vA;
void main() { vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard; gl_FragColor = vec4(1.0, 0.95, 0.82, vA * (1.0 - d * 4.0)); }`;

/** Same sunbeam footprints as Decor (under the back-wall windows at x 1.8 / 3.0 and the left-wall window at z 1.8). */
export function moteSeeds(n = MOTES, seed = 7) {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const pos = new Float32Array(n * 3), phase = new Float32Array(n);
  const beams = [[1.8, 0.75, 'z'], [3.0, 0.75, 'z'], [0.75, 1.8, 'x']] as const;
  for (let i = 0; i < n; i++) {
    const [bx, bz, axis] = beams[i % 3]; const a = (rnd() - 0.5) * 0.55, b = (rnd() - 0.5) * 1.1;
    pos[i * 3] = axis === 'z' ? bx + a : bx + b; pos[i * 3 + 1] = 0.15 + rnd() * 1.1; pos[i * 3 + 2] = axis === 'z' ? bz + b : bz + a; phase[i] = rnd();
  }
  return { pos, phase };
}

export function Ambience({ beamMaterial }: { beamMaterial?: THREE.Material | null }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const pts = useMemo(() => {
    const { pos, phase } = moteSeeds(); const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uTime: { value: 0 }, uPx: { value: 2 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m); p.raycast = () => {}; p.frustumCulled = false; p.renderOrder = 2; return p;
  }, []);
  useEffect(() => () => { pts.geometry.dispose(); (pts.material as THREE.Material).dispose(); }, [pts]);
  useFrame(({ clock }) => {
    const m = pts.material as THREE.ShaderMaterial; m.uniforms.uTime.value = clock.elapsedTime; m.uniforms.uPx.value = 2.2 * dpr;
    if (beamMaterial) beamMaterial.opacity = 0.72 + Math.sin(clock.elapsedTime * 0.45) * 0.1;
  });
  return <primitive object={pts} />;
}
