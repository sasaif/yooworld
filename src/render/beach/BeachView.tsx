import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { BEACH_PROPS, BEACH_CENTER, CAFE, DANCE_FLOOR, propById, type BeachProp } from '../../game/beach/beachLayout';
import { Q } from '../quality';
import { TapMarker } from '../apartment/ApartmentView';
import { swayMaterial } from './meshBuilder';
import { buildBeachProps, buildBoat, lanternBulbs } from './beachProps';
import { beachTime, mood, sandTexture, sparkleMaterial, waterMaterial } from './water';

/**
 * Yoo Plage scene. Draw-call budget (measured with window.__info): sand 1, sea 1, props batch 1 (+1 shadow),
 * boat 1 (+1), string-light bulbs 1, dance floor 1, sparkles 1, gulls 1, 3 painted signs, DJ beams 2.
 */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const noRay = () => {};

function Ground() {
  const tex = useMemo(() => { const t = sandTexture(); t.repeat.set(24, 24); return t; }, []);
  const water = useMemo(() => waterMaterial(), []);
  const lastTap = useRef({ t: 0, p: new THREE.Vector3() });
  useFrame(() => { water.uniforms.uTime.value = beachTime.value; water.uniforms.uMood.value = mood.value; });
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return; e.stopPropagation();
    const now = performance.now(); const dbl = now - lastTap.current.t < 380 && e.point.distanceTo(lastTap.current.p) < 0.6; lastTap.current = { t: now, p: e.point.clone() };
    if (game.walkTo(e.point.clone(), dbl)) { window.dispatchEvent(new Event('yw:follow')); window.dispatchEvent(new CustomEvent('yw:marker', { detail: e.point.clone() })); }
  };
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[8, 0, 5]} receiveShadow onClick={onClick}><planeGeometry args={[90, 90]} /><meshLambertMaterial map={tex} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-14, 0.012, 5]} material={water} raycast={noRay}><planeGeometry args={[40, 90]} /></mesh>
      <TapMarker />
    </group>
  );
}

function Props() {
  const { geometry } = useMemo(() => buildBeachProps(), []);
  const mat = useMemo(() => swayMaterial(beachTime, { side: THREE.DoubleSide, flatShading: true }), []);
  return <mesh geometry={geometry} material={mat} castShadow receiveShadow raycast={noRay} />;
}
function Boat() {
  const geo = useMemo(() => buildBoat(), []); const mat = useMemo(() => new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), []);
  const ref = useRef<THREE.Group>(null!);
  useFrame(() => { const t = beachTime.value; const g = ref.current; g.position.set(-2.2 + Math.sin(t * 0.05) * 1.2, Math.sin(t * 1.1) * 0.04, 6.4 + Math.sin(t * 0.03) * 0.8); g.rotation.set(Math.sin(t * 0.9) * 0.05, 0.5, Math.sin(t * 1.2) * 0.06); });
  return <group ref={ref}><mesh geometry={geo} material={mat} castShadow raycast={noRay} /></group>;
}
/** Painted signs: café front, menu board and the "Yoo Plage" welcome board. */
function Signs() {
  const t = useMemo(() => ({
    cafe: canvasTex(512, 128, (g) => { g.fillStyle = '#fff6ee'; g.fillRect(0, 0, 512, 128); g.fillStyle = '#e2569b'; g.font = '900 74px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CAFÉ YOO', 256, 68); g.fillStyle = '#5cc2c9'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10); }),
    menu: canvasTex(256, 320, (g) => { g.fillStyle = '#2f3a3a'; g.fillRect(0, 0, 256, 320); g.strokeStyle = '#c98f5f'; g.lineWidth = 14; g.strokeRect(7, 7, 242, 306); g.fillStyle = '#fff6ee'; g.textAlign = 'center'; g.font = '800 34px system-ui'; g.fillText('MENU', 128, 56); g.font = '600 24px system-ui'; ['Smoothie 🥭', 'Glace 🍦', 'Café glacé', 'Coco frais 🥥'].forEach((s, i) => g.fillText(s, 128, 112 + i * 50)); }),
    plage: canvasTex(512, 200, (g) => { const s = g.createLinearGradient(0, 0, 512, 0); s.addColorStop(0, '#5cc2c9'); s.addColorStop(1, '#4f8be0'); g.fillStyle = s; g.fillRect(0, 0, 512, 200); g.fillStyle = '#fff'; g.font = '900 86px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Yoo Plage', 256, 92); g.font = '700 30px system-ui'; g.fillStyle = '#ffe7a8'; g.fillText('☀ café · DJ · détente ☀', 256, 160); }),
  }), []);
  const sign = propById('sign')!;
  return (
    <group>
      <mesh position={[CAFE.x, 2.6, CAFE.z + 0.45]} raycast={noRay} castShadow><boxGeometry args={[1.7, 0.42, 0.05]} /><meshLambertMaterial map={t.cafe} /></mesh>
      <mesh position={[CAFE.x + CAFE.w / 2 + 0.3, 0.55, CAFE.z + 0.7]} rotation-y={-0.35} raycast={noRay} castShadow><boxGeometry args={[0.44, 0.56, 0.03]} /><meshLambertMaterial map={t.menu} /></mesh>
      <group position={[sign.x, 0, sign.z]} rotation-y={sign.yaw}><mesh position={[0, 0.92, 0.035]} raycast={noRay} castShadow><boxGeometry args={[1.0, 0.4, 0.04]} /><meshLambertMaterial map={t.plage} /></mesh></group>
    </group>
  );
}
function Lanterns() {
  const { bulbs, glow, wire } = useMemo(() => lanternBulbs(), []);
  const all = useMemo(() => [...bulbs, ...glow], [bulbs, glow]);
  const inst = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), all.length);
    const pal = ['#ffe3a3', '#ffc1d9', '#bfe3ff', '#fff1c9']; const c = new THREE.Color(); const mx = new THREE.Matrix4();
    all.forEach((b, i) => { const s = i >= bulbs.length ? 0.075 : 0.03; m.setMatrixAt(i, mx.compose(b, new THREE.Quaternion(), new THREE.Vector3(s, s * (i >= bulbs.length ? 1.25 : 1), s))); m.setColorAt(i, c.set(i >= bulbs.length ? '#ffd27a' : pal[i % pal.length])); });
    m.raycast = noRay; return m;
  }, [all, bulbs.length]);
  const wireGeo = useMemo(() => new THREE.BufferGeometry().setFromPoints(wire), [wire]);
  useFrame(() => { const k = 0.55 + mood.value * 0.75 + Math.sin(beachTime.value * 3) * 0.04 * mood.value; (inst.material as THREE.MeshBasicMaterial).color.setScalar(k); });
  return <><primitive object={inst} /><lineSegments geometry={wireGeo} raycast={noRay}><lineBasicMaterial color="#6b5a4e" transparent opacity={0.6} /></lineSegments></>;
}
/** Light-up dance floor: one InstancedMesh, tile colours animate on the beat when the DJ plays. */
function DanceFloor() {
  const music = useStore(game.store, (s) => s.beachMusic);
  const n = DANCE_FLOOR.tiles, s = DANCE_FLOOR.size / n;
  const inst = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(s - 0.025, 0.018, s - 0.025), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n * n);
    const mx = new THREE.Matrix4(); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) m.setMatrixAt(j * n + i, mx.makeTranslation(DANCE_FLOOR.x - DANCE_FLOOR.size / 2 + (i + 0.5) * s, 0.009, DANCE_FLOOR.z - DANCE_FLOOR.size / 2 + (j + 0.5) * s));
    m.receiveShadow = true; return m;
  }, [n, s]);
  const pal = useMemo(() => ['#e2569b', '#5cc2c9', '#ffc857', '#9b6be0', '#ff8a5c', '#4f8be0'].map((c) => new THREE.Color(c)), []);
  const c = useMemo(() => new THREE.Color(), []); const last = useRef(-1);
  useFrame(() => {
    const beat = Math.floor(beachTime.value * 2.1); if (beat === last.current && !music) return; last.current = beat;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (music) { const lit = (i + j + beat) % 3 === 0 || ((i * 7 + j * 3 + beat) % 5 === 0); c.copy(pal[(i + j * 2 + beat) % pal.length]); if (!lit) c.multiplyScalar(0.35); else c.multiplyScalar(1.25); }
      else c.copy(pal[(i + j) % pal.length]).lerp(new THREE.Color('#fff6ee'), 0.55);
      inst.setColorAt(k, c);
    }
    inst.instanceColor!.needsUpdate = true;
  });
  const onClick = (e: ThreeEvent<MouseEvent>) => { if (e.delta > 8) return; e.stopPropagation(); game.tapProp('floor'); };
  return <primitive object={inst} onClick={onClick} />;
}
function DjFx() {
  const music = useStore(game.store, (s) => s.beachMusic); const dj = propById('dj')!;
  const a = useRef<THREE.Mesh>(null!), b = useRef<THREE.Mesh>(null!);
  const geo = useMemo(() => { const g = new THREE.ConeGeometry(0.55, 2.1, 16, 1, true); g.translate(0, -1.05, 0); return g; }, []);
  useFrame(() => { const t = beachTime.value; if (!a.current) return; a.current.rotation.set(0.35 + Math.sin(t * 1.3) * 0.3, 0, Math.sin(t * 0.9) * 0.45); b.current.rotation.set(0.35 + Math.cos(t * 1.1) * 0.3, 0, -Math.sin(t * 1.2) * 0.45); });
  if (!music) return null;
  return (
    <group position={[dj.x, 2.12, dj.z]} rotation-y={dj.yaw}>
      <mesh ref={a} position-x={-0.75} geometry={geo} raycast={noRay}><meshBasicMaterial color="#ff7ac8" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      <mesh ref={b} position-x={0.75} geometry={geo} raycast={noRay}><meshBasicMaterial color="#7ae8ff" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} /></mesh>
      <Html position={[0, -0.9, 0.2]} center style={{ pointerEvents: 'none' }}><div className="notes">♪ ♫ ♪</div></Html>
    </group>
  );
}
/** Seagulls circling over the sea (one InstancedMesh, wing flap = vertical scale). */
function Gulls() {
  const N = 6;
  const inst = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.22, 0.06, -0.02), new THREE.Vector3(0, 0, 0.05), new THREE.Vector3(0, 0, -0.04),
      new THREE.Vector3(0.22, 0.06, -0.02), new THREE.Vector3(0, 0, -0.04), new THREE.Vector3(0, 0, 0.05),
    ]); g.computeVertexNormals();
    const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), N); m.raycast = noRay; return m;
  }, []);
  const mx = useMemo(() => new THREE.Matrix4(), []), q = useMemo(() => new THREE.Quaternion(), []), e = useMemo(() => new THREE.Euler(), []), p = useMemo(() => new THREE.Vector3(), []), sc = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = beachTime.value;
    for (let i = 0; i < N; i++) {
      const r = 2.2 + (i % 3) * 0.9, w = 0.22 + (i % 2) * 0.07, a = t * w + i * 1.7;
      p.set(0.8 + Math.cos(a) * r * 1.3, 2.9 + (i % 3) * 0.45 + Math.sin(t * 0.7 + i) * 0.15, 4.5 + Math.sin(a) * r);
      e.set(0, -a + Math.PI, Math.sin(a) * 0.2); q.setFromEuler(e); const f = Math.sin(t * 7 + i * 2.3);
      sc.set(1.25, f * 1.4 + 0.2, 1.25); inst.setMatrixAt(i, mx.compose(p, q, sc));
    }
    inst.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={inst} />;
}
function Sparkles() {
  const { gl } = useThree(); const mat = useMemo(() => sparkleMaterial(), []);
  const geo = useMemo(() => {
    const pts: number[] = [], seed: number[] = [], kind: number[] = []; let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { pts.push(-1 - r() * 9, 0.04, r() * 12); seed.push(r()); kind.push(0); }
    for (let i = 0; i < 46; i++) { const near = i % 2 ? [DANCE_FLOOR.x, DANCE_FLOOR.z] : [7.5 + r() * 2, 6 + r() * 3]; pts.push(near[0] + (r() - 0.5) * 3.2, 0.5 + r() * 1.6, near[1] + (r() - 0.5) * 3.2); seed.push(r()); kind.push(1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1)); g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1)); return g;
  }, []);
  useFrame(() => { mat.uniforms.uTime.value = beachTime.value; mat.uniforms.uMood.value = mood.value; mat.uniforms.uScale.value = gl.getPixelRatio(); });
  return <points geometry={geo} material={mat} raycast={noRay} frustumCulled={false} />;
}
/** Invisible tap targets for interactive props (no draw calls). */
function HitBoxes() {
  const items = BEACH_PROPS.filter((p) => p.actions?.length && p.kind !== 'danceFloor');
  const size = (p: BeachProp): [number, number, number, number] => {
    switch (p.kind) {
      case 'kiosk': return [CAFE.w, 2.2, CAFE.d + 0.4, 1.1];
      case 'bench': return [1.3, 0.6, 0.45, 0.3];
      case 'lounger': return [0.55, 0.65, 0.95, 0.3];
      case 'towel': return [0.8, 0.05, 1.6, 0.02];
      case 'djBooth': return [2.4, 1.0, 0.6, 0.5]; // local frame (rotated with the booth)
      case 'cafeChair': return [0.42, 0.7, 0.42, 0.35];
      case 'cafeTable': return [0.6, 0.5, 0.6, 0.25];
      case 'sign': return [1.0, 1.2, 0.2, 0.6];
      default: return [0.8, 0.8, 0.8, 0.4];
    }
  };
  return <>{items.map((p) => { const [w, h, d, y] = size(p);
    return <mesh key={p.id} position={[p.x, y, p.z]} rotation-y={p.yaw} visible={false}
      onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); game.tapProp(p.id); }}><boxGeometry args={[w, h, d]} /></mesh>; })}</>;
}
const LABEL: Record<string, (p: BeachProp) => string> = {
  sit: (p) => (p.kind === 'lounger' || p.kind === 'towel' ? '🏖️ S’installer' : '🪑 S’asseoir'),
  dance: () => '💃 Danser', order: () => '🍹 Commander', look: () => '👀 Regarder',
  music: () => (game.s.beachMusic ? '🔇 Couper le son' : '🎵 Lancer la musique'),
};
function BeachMenu({ id }: { id: string }) {
  const p = propById(id); useStore(game.store, (s) => s.beachMusic); if (!p?.actions) return null;
  const y = p.kind === 'kiosk' ? 2.0 : p.kind === 'djBooth' ? 1.25 : p.kind === 'danceFloor' ? 0.6 : 0.9;
  return (
    <Html position={[p.x, y, p.z]} center zIndexRange={[40, 20]}>
      <div className="imenu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="imenu-title">{p.name}</div>
        {p.actions.map((a) => <button key={a} className="btn" onClick={() => game.interactProp(p.id, a)}>{LABEL[a](p)}</button>)}
      </div>
    </Html>
  );
}

/** Day ↔ sunset ambience: lights, fog and shader uniforms follow `mood` (eased; 'cycle' = slow loop). */
export function BeachAmbience() {
  const moodMode = useStore(game.store, (s) => s.mood);
  const hemi = useRef<THREE.HemisphereLight>(null!), sun = useRef<THREE.DirectionalLight>(null!), fill = useRef<THREE.DirectionalLight>(null!);
  const lamps = useRef<(THREE.PointLight | null)[]>([]); const fog = useRef<THREE.Fog>(null!);
  const K = useMemo(() => ({
    skyD: new THREE.Color('#fff4e2'), skyS: new THREE.Color('#ffc3a0'), gndD: new THREE.Color('#d1ab80'), gndS: new THREE.Color('#9a6aa8'),
    sunD: new THREE.Color('#fff0d8'), sunS: new THREE.Color('#ff8a4c'), fogD: new THREE.Color('#bfe8f2'), fogS: new THREE.Color('#f29a9a'), fillD: new THREE.Color('#d9ecff'), fillS: new THREE.Color('#9a7ad8'),
  }), []);
  const target = useMemo(() => { const o = new THREE.Object3D(); o.position.set(BEACH_CENTER.x, 0, BEACH_CENTER.z); return o; }, []);
  useFrame((_, dt) => {
    beachTime.value += Math.min(dt, 0.1);
    const goal = moodMode === 'sunset' ? 1 : moodMode === 'day' ? 0 : 0.5 - 0.5 * Math.cos((beachTime.value / 90) * Math.PI * 2);
    mood.value += (goal - mood.value) * Math.min(1, dt * (moodMode === 'cycle' ? 4 : 1.6)); const m = mood.value;
    if (!hemi.current) return;
    hemi.current.color.lerpColors(K.skyD, K.skyS, m); hemi.current.groundColor.lerpColors(K.gndD, K.gndS, m); hemi.current.intensity = 1.15 - m * 0.15;
    sun.current.color.lerpColors(K.sunD, K.sunS, m); sun.current.intensity = 2.6 - m * 0.9;
    // sun swings from high south-east to low over the sea (long warm shadows)
    const el = THREE.MathUtils.lerp(1.05, 0.38, m), az = THREE.MathUtils.lerp(0.55, -0.55, m);
    sun.current.position.set(BEACH_CENTER.x + Math.cos(el) * Math.sin(az) * 12 - m * 6, Math.sin(el) * 12, BEACH_CENTER.z + Math.cos(el) * Math.cos(az) * 12);
    fill.current.color.lerpColors(K.fillD, K.fillS, m); fill.current.intensity = 0.4 + m * 0.25;
    lamps.current.forEach((l, i) => { if (l) l.intensity = m * (i ? 2.6 : 2.2); });
    fog.current?.color.lerpColors(K.fogD, K.fogS, m);
  });
  return (
    <>
      <fog ref={fog} attach="fog" args={['#bfe8f2', 38, 75]} />
      <primitive object={target} />
      <hemisphereLight ref={hemi} args={['#fff4e2', '#d1ab80', 1.15]} />
      <directionalLight ref={sun} target={target} intensity={2.6} castShadow shadow-mapSize={[Q.shadowMap * 2 > 4096 ? 4096 : Q.shadowMap * 2, Q.shadowMap * 2 > 4096 ? 4096 : Q.shadowMap * 2]} shadow-bias={-0.0004} shadow-normalBias={0.03}
        shadow-radius={3} shadow-camera-left={-11} shadow-camera-right={11} shadow-camera-top={11} shadow-camera-bottom={-11} shadow-camera-far={40} />
      <directionalLight ref={fill} position={[BEACH_CENTER.x - 6, 6, BEACH_CENTER.z + 8]} intensity={0.4} />
      <pointLight ref={(r) => { lamps.current[0] = r; }} position={[CAFE.x, 1.6, CAFE.z + 1.4]} color="#ffb870" intensity={0} distance={5} decay={1.4} />
      <pointLight ref={(r) => { lamps.current[1] = r; }} position={[DANCE_FLOOR.x, 1.8, DANCE_FLOOR.z]} color="#ff9ad5" intensity={0} distance={5} decay={1.4} />
    </>
  );
}

export function BeachView() {
  const menu = useStore(game.store, (s) => s.menuItem);
  return (
    <group>
      <Ground />
      <Props />
      <Boat />
      <Signs />
      <Lanterns />
      <DanceFloor />
      <DjFx />
      <Gulls />
      <Sparkles />
      <HitBoxes />
      {menu && propById(menu) && <BeachMenu id={menu} />}
    </group>
  );
}
