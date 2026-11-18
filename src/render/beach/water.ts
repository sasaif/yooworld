import * as THREE from 'three';

/** Shoreline in GLSL — must match shoreX() in game/beach/beachLayout.ts. */
const SHORE = 'float shoreX(float z) { return 3.4 + 0.45 * sin(0.55 * z + 0.6) + 0.2 * sin(1.3 * z); }';
export const mood = { value: 0 }; // 0 = day … 1 = sunset (driven by BeachAmbience)
export const beachTime = { value: 0 };

/**
 * Stylised sea: depth gradient from the shoreline, animated ripples, a breaking foam line that
 * washes up and down the sand, a wet-sand band, and warm glints at sunset. One draw call, no textures.
 */
let _water: THREE.ShaderMaterial | null = null;
export function waterMaterial() {
  if (_water) return _water;
  return _water = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uMood: { value: 0 },
      uShallowDay: { value: new THREE.Color('#62d8d2') }, uDeepDay: { value: new THREE.Color('#2b8fd0') },
      uShallowSun: { value: new THREE.Color('#f2a08a') }, uDeepSun: { value: new THREE.Color('#5a4a9e') },
      uWet: { value: new THREE.Color('#c8a074') },
    }]),
    vertexShader: /* glsl */`
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform float uMood;
      uniform vec3 uShallowDay; uniform vec3 uDeepDay; uniform vec3 uShallowSun; uniform vec3 uDeepSun; uniform vec3 uWet;
      varying vec3 vW;
      #include <fog_pars_fragment>
      ${SHORE}
      void main() {
        float x = vW.x, z = vW.z;
        float wash = 0.16 * sin(uTime * 0.7) + 0.05 * sin(uTime * 1.9 + z * 1.6);
        float d = shoreX(z) + wash - x;                      // > 0 in the water
        if (d < -0.5) discard;
        float depth = clamp(d / 7.0, 0.0, 1.0);
        vec3 shallow = mix(uShallowDay, uShallowSun, uMood), deep = mix(uDeepDay, uDeepSun, uMood);
        vec3 col = mix(shallow, deep, smoothstep(0.0, 1.0, depth));
        float r = sin(x * 2.6 + uTime * 1.1 + sin(z * 1.2 + uTime * 0.3) * 2.2) * sin(z * 2.2 - uTime * 0.7 + x * 0.4);
        float glint = smoothstep(0.82, 1.0, r) * (0.12 + 0.25 * uMood) * smoothstep(0.2, 1.2, d);
        col += glint * mix(vec3(1.0), vec3(1.0, 0.82, 0.45), uMood);
        float foam = smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.1, 0.26, d));
        float band = (smoothstep(0.55, 0.62, d) * (1.0 - smoothstep(0.62, 0.78, d))) * (0.45 + 0.35 * sin(z * 2.3 + uTime * 1.3));
        col = mix(col, vec3(1.0, 0.98, 0.95), clamp(foam * 0.9 + band * 0.55, 0.0, 1.0));
        float a = 0.94;
        if (d < 0.0) { col = uWet * mix(vec3(1.0), vec3(1.05, 0.85, 0.85), uMood); a = 0.28 * (1.0 + d / 0.5); }
        gl_FragColor = vec4(col, a);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Sand: warm base with speckles, ripples and a few darker patches (canvas texture, tiled). Cached: one GPU texture for the whole session. */
let _sand: THREE.CanvasTexture | null = null;
export function sandTexture() {
  if (_sand) return _sand;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = '#f3d9ae'; g.fillRect(0, 0, 256, 256);
  let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) { const x = rnd() * 256, y = rnd() * 256, r = 18 + rnd() * 40; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rnd() > 0.5 ? 'rgba(255,236,200,0.5)' : 'rgba(226,190,140,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  g.strokeStyle = 'rgba(214,176,128,0.25)'; g.lineWidth = 2;
  for (let k = 0; k < 9; k++) { g.beginPath(); for (let x = 0; x <= 256; x += 8) { const y = k * 29 + 10 + Math.sin(x / 22 + k) * 5; if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
  for (let i = 0; i < 1400; i++) { g.fillStyle = rnd() > 0.5 ? 'rgba(190,150,100,0.35)' : 'rgba(255,250,235,0.6)'; g.fillRect(rnd() * 256, rnd() * 256, 1.2, 1.2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return _sand = t;
}
/** Twinkles: sea glitter by day, fireflies / floating embers at sunset. One Points draw call. */
let _sparkle: THREE.ShaderMaterial | null = null;
export function sparkleMaterial() {
  if (_sparkle) return _sparkle;
  return _sparkle = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uMood: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSeed; attribute float aKind; uniform float uTime; uniform float uMood; uniform float uScale; varying float vA; varying float vKind;
      void main() {
        vec3 p = position; float t = uTime + aSeed * 37.0;
        if (aKind > 0.5) { p.y += 0.25 * sin(t * 0.6) ; p.x += 0.2 * sin(t * 0.37); p.z += 0.2 * cos(t * 0.41); }
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float tw = pow(max(0.0, sin(t * (aKind > 0.5 ? 1.3 : 2.7))), aKind > 0.5 ? 2.0 : 8.0);
        vA = tw * (aKind > 0.5 ? smoothstep(0.35, 0.9, uMood) : (0.65 - 0.35 * uMood)); vKind = aKind;
        gl_PointSize = (aKind > 0.5 ? 7.0 : 6.0) * uScale;
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying float vKind;
      void main() { vec2 q = gl_PointCoord - 0.5; float d = length(q); float star = max(0.0, 1.0 - d * 2.0); if (vKind < 0.5) star = max(star * star, max(0.0, 1.0 - abs(q.x) * 9.0) * max(0.0, 1.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 9.0) * max(0.0, 1.0 - abs(q.x) * 2.2));
        vec3 c = vKind > 0.5 ? vec3(1.0, 0.82, 0.45) : vec3(1.0); gl_FragColor = vec4(c * star * vA, 1.0); }`,
  });
}
