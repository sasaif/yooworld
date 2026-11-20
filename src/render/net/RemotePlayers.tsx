/** `?net=1` only: other players synced from the local server, drawn as simple markers (Phase B placeholder, not the
 *  real avatar look). Mounted by App ONLY when the flag is on; positions are smoothed toward the latest snapshot. */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import type { LiveTransport } from '../../net/live/LiveTransport';
import type { Remote } from '../../net/live/NetSync';

function Marker({ r }: { r: Remote }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => { const o = g.current; if (!o) return; const k = Math.min(1, dt * 10); o.position.x += (r.x - o.position.x) * k; o.position.z += (r.z - o.position.z) * k; });
  return (
    <group ref={g} position={[r.x, 0, r.z]} name={'remote-' + r.id}>
      <mesh position={[0, 0.55, 0]} castShadow><capsuleGeometry args={[0.2, 0.7, 4, 12]} /><meshStandardMaterial color="#6c8cff" /></mesh>
      <Html position={[0, 1.35, 0]} center distanceFactor={8}><div className="yw-remote-tag" style={{ background: 'rgba(20,24,40,.8)', color: '#fff', padding: '1px 6px', borderRadius: 6, font: '11px system-ui', whiteSpace: 'nowrap' }}>{r.label}</div></Html>
    </group>
  );
}
export default function RemotePlayers({ net }: { net: LiveTransport }) {
  const [, setV] = useState(0);
  useEffect(() => { const t = setInterval(() => setV(net.sync.version), 250); return () => clearInterval(t); }, [net]);
  return <>{[...net.sync.remotes.values()].map((r) => <Marker key={r.id} r={r} />)}</>;
}
