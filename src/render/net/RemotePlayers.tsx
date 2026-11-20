/** `?net=1` only: other players synced from the local server, drawn with the EXISTING avatar renderer (`Character`,
 *  `lite` crowd budget — same body/look/animations as PNJ and club bots, no new asset). Mounted by App ONLY when the
 *  flag is on. Each remote gets its own display-only CharState (never put in `world.chars`, never saved): the latest
 *  server position becomes a one-point path, so the stock locomotion walks/runs the avatar there; far jumps snap. */
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Character } from '../Character';
import { AVATARS, type AvatarDef } from '../../data/avatars';
import { BOT_LOOKS } from '../../game/club/botAvatars';
import { makeChar } from '../../game/world';
import type { LiveTransport } from '../../net/live/LiveTransport';
import type { Remote } from '../../net/live/NetSync';
import { remoteLookIndex, remoteTarget } from '../../net/live/remoteAvatar';

const REMOTE_TAG = '#3a5bd9';
const noop = () => {};

function RemoteAvatar({ r }: { r: Remote }) {
  const c = useMemo(() => makeChar('net-' + r.id, r.label, r.x, r.z), [r.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = BOT_LOOKS[remoteLookIndex(r.id, BOT_LOOKS.length)];
  const def = useMemo<AvatarDef>(() => ({ ...AVATARS[look.body], id: 'net-' + r.id, tagColor: REMOTE_TAG, label: r.label }), [look, r.id, r.label]);
  const tgt = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const t = remoteTarget(c.pos.x, c.pos.z, r.x, r.z);
    if (t.snap) { c.pos.set(r.x, 0, r.z); c.path = []; c.speed = 0; return; }
    if (!t.move) return;
    tgt.set(r.x, 0, r.z);
    const last = c.path[c.path.length - 1];
    if (!last || last.distanceToSquared(tgt) > 1e-4) c.path = [tgt.clone()];
    c.running = t.run;
  });
  return <Character c={c} def={def} look={look} selected={false} onSelect={noop} npcLabel="en ligne" lite />;
}
export default function RemotePlayers({ net }: { net: LiveTransport }) {
  const [, setV] = useState(0);
  useEffect(() => { const t = setInterval(() => setV(net.sync.version), 250); return () => clearInterval(t); }, [net]);
  return <>{[...net.sync.remotes.values()].map((r) => <RemoteAvatar key={r.id} r={r} />)}</>;
}
