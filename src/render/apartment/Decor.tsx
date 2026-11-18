import { useEffect, useMemo, useState } from 'react';
import { Ambience } from './Ambience';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, type ApartmentLayout } from '../../game/apartment/ApartmentModel';
import { disposeMesh } from '../dispose';

/**
 * Static environment dressing (not part of the saved layout, not selectable): framed art, fairy lights,
 * sunbeams under the windows and a doormat. Everything is procedural (canvas textures, no new assets)
 * and batched: ~6 draw calls in total.
 */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const ART: ((g: CanvasRenderingContext2D, w: number, h: number) => void)[] = [
  (g, w, h) => { // sunset over hills
    const s = g.createLinearGradient(0, 0, 0, h); s.addColorStop(0, '#ffd6a5'); s.addColorStop(1, '#ff9fb2'); g.fillStyle = s; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(w * 0.62, h * 0.48, w * 0.18, 0, 7); g.fill();
    g.fillStyle = '#c77dab'; g.beginPath(); g.moveTo(0, h * 0.72); g.quadraticCurveTo(w * 0.35, h * 0.5, w, h * 0.7); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.fillStyle = '#8e5c9e'; g.beginPath(); g.moveTo(0, h * 0.85); g.quadraticCurveTo(w * 0.6, h * 0.66, w, h * 0.88); g.lineTo(w, h); g.lineTo(0, h); g.fill();
  },
  (g, w, h) => { // pastel shapes
    g.fillStyle = '#fff6ee'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2569b'; g.beginPath(); g.arc(w * 0.35, h * 0.38, w * 0.2, 0, 7); g.fill();
    g.fillStyle = '#4f8be0'; g.fillRect(w * 0.45, h * 0.45, w * 0.32, h * 0.32);
    g.fillStyle = '#ffc857'; g.beginPath(); g.moveTo(w * 0.2, h * 0.85); g.lineTo(w * 0.5, h * 0.55); g.lineTo(w * 0.8, h * 0.85); g.fill();
  },
  (g, w, h) => { // palm beach (wide)
    const s = g.createLinearGradient(0, 0, 0, h); s.addColorStop(0, '#9fd8ff'); s.addColorStop(0.62, '#e8f7ff'); s.addColorStop(0.63, '#5cc2c9'); s.addColorStop(1, '#f6dcae'); g.fillStyle = s; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.8, h * 0.25, h * 0.12, 0, 7); g.fill();
    g.strokeStyle = '#8a5a3c'; g.lineWidth = w * 0.02; g.beginPath(); g.moveTo(w * 0.22, h); g.quadraticCurveTo(w * 0.2, h * 0.5, w * 0.3, h * 0.3); g.stroke();
    g.fillStyle = '#3fa86b'; for (let a = 0; a < 6; a++) { g.beginPath(); g.ellipse(w * 0.3, h * 0.3, w * 0.12, h * 0.05, a * 1.05, 0, 7); g.fill(); }
  },
];

export function Decor({ apt }: { apt: ApartmentLayout }) {
  const W = apt.cols * CELL, D = apt.rows * CELL;
  const built = useMemo(() => {
    // framed art: [axis, position along wall, centre height, width, height, art index]
    const frames: { wall: 'back' | 'left'; at: number; y: number; w: number; h: number; art: number }[] = [
      { wall: 'back', at: 0.62, y: 1.0, w: 0.34, h: 0.44, art: 1 },
      { wall: 'left', at: 3.05, y: 1.06, w: 0.4, h: 0.3, art: 0 },
      { wall: 'left', at: 4.62, y: 1.0, w: 0.86, h: 0.42, art: 2 },
    ];
    const frameGeos: THREE.BufferGeometry[] = []; const arts: { geo: THREE.BufferGeometry; tex: THREE.Texture }[] = [];
    frames.forEach((f) => {
      const o = new THREE.Object3D(); if (f.wall === 'back') { o.position.set(f.at, f.y, 0.075); } else { o.position.set(0.075, f.y, f.at); o.rotation.y = Math.PI / 2; } o.updateMatrix();
      const fr = new THREE.BoxGeometry(f.w + 0.06, f.h + 0.06, 0.03); fr.applyMatrix4(o.matrix); frameGeos.push(fr);
      const p = new THREE.PlaneGeometry(f.w, f.h); p.translate(0, 0, 0.017); p.applyMatrix4(o.matrix);
      const r = f.w / f.h; arts.push({ geo: p, tex: canvasTex(Math.round(128 * Math.max(1, r)), Math.round(128 / Math.min(1, r)), (g) => ART[f.art](g, g.canvas.width, g.canvas.height)) });
    });
    // fairy lights hanging under the top of the back + left walls (one InstancedMesh)
    const bulbs: THREE.Vector3[] = []; const H = 1.43;
    for (let x = 0.15; x < W - 0.1; x += 0.24) bulbs.push(new THREE.Vector3(x, H - Math.abs(Math.sin((x / 1.2) * Math.PI)) * 0.07, 0.09));
    for (let z = 0.3; z < D - 0.1; z += 0.24) bulbs.push(new THREE.Vector3(0.09, H - Math.abs(Math.sin((z / 1.2) * Math.PI)) * 0.07, z));
    const wire = new THREE.BufferGeometry().setFromPoints(bulbs.flatMap((b, i) => (i && bulbs[i - 1].distanceTo(b) < 0.4 ? [bulbs[i - 1], b] : [])));
    // warm sunbeams on the floor under the windows (fake light shafts, additive)
    const beamTex = canvasTex(64, 128, (g) => { const s = g.createLinearGradient(0, 0, 0, 128); s.addColorStop(0, 'rgba(255,236,190,0.9)'); s.addColorStop(1, 'rgba(255,236,190,0)'); g.fillStyle = s; g.fillRect(0, 0, 64, 128); });
    const beam = (cx: number, cz: number, rot: number) => { const p = new THREE.PlaneGeometry(0.62, 1.25); p.translate(0, -0.62, 0); p.rotateX(-Math.PI / 2); p.rotateY(rot); p.translate(cx, 0.008, cz); return p; };
    const beams = mergeGeometries([beam(1.8, 0.1, Math.PI), beam(3.0, 0.1, Math.PI), beam(0.1, 1.8, -Math.PI / 2)].map((g) => { g.rotateY(0); return g; }));
    // doormat in front of the door (door cells 16-19 -> x 4.8-6.0)
    const matTex = canvasTex(256, 128, (g) => { g.fillStyle = '#b9658a'; g.fillRect(0, 0, 256, 128); g.strokeStyle = '#ffd6e6'; g.lineWidth = 6; g.strokeRect(10, 10, 236, 108); g.fillStyle = '#fff6f0'; g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('Bienvenue', 128, 66); });
    return { frame: mergeGeometries(frameGeos), arts, bulbs, wire, beams, beamTex, matTex };
  }, [W, D]);
  const inst = useMemo(() => {
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe3a3', toneMapped: false }), built.bulbs.length);
    const pal = ['#ffe3a3', '#ffc1d9', '#bfe3ff', '#fff1c9']; const c = new THREE.Color(); const mx = new THREE.Matrix4();
    built.bulbs.forEach((b, i) => { m.setMatrixAt(i, mx.makeTranslation(b.x, b.y, b.z)); m.setColorAt(i, c.set(pal[i % pal.length])); });
    m.raycast = () => {}; return m;
  }, [built]);
  const [beamMat, setBeamMat] = useState<THREE.Material | null>(null);
  useEffect(() => () => {
    built.frame?.dispose(); built.wire.dispose(); built.beams?.dispose(); built.beamTex.dispose(); built.matTex.dispose();
    built.arts.forEach((a) => { a.geo.dispose(); a.tex.dispose(); });
    disposeMesh(inst);
  }, [built, inst]);
  return (
    <group>
      <mesh geometry={built.frame} castShadow raycast={() => {}}><meshLambertMaterial color="#c98f5f" /></mesh>
      {built.arts.map((a, i) => <mesh key={i} geometry={a.geo} raycast={() => {}}><meshLambertMaterial map={a.tex} /></mesh>)}
      <primitive object={inst} />
      <lineSegments geometry={built.wire} raycast={() => {}}><lineBasicMaterial color="#6b5a4e" transparent opacity={0.6} /></lineSegments>
      <mesh geometry={built.beams} renderOrder={1} raycast={() => {}}><meshBasicMaterial ref={setBeamMat} map={built.beamTex} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} /></mesh>
      <Ambience beamMaterial={beamMat} />
      {/* hallway seen through the open doorway (instead of the backdrop) */}
      <mesh position={[5.4, 0.62, -0.09]} raycast={() => {}}><planeGeometry args={[1.0, 1.3]} /><meshBasicMaterial color="#7d5f86" /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[5.4, 0.006, 0.42]} receiveShadow raycast={() => {}}><planeGeometry args={[0.62, 0.32]} /><meshLambertMaterial map={built.matTex} /></mesh>
    </group>
  );
}
