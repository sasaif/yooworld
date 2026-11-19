import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortal, useThree } from '@react-three/fiber';
import { BeachAmbience, BeachView } from '../beach/BeachView';
import { collectRenderables, finishPrograms, warmPrograms } from './programs';

/** Name of the apartment scene root (ApartmentView): everything else in the main scene comes along to the beach. */
export const APARTMENT_ROOT = 'location:apartment';
const ENABLED = new URLSearchParams(location.search).get('prewarm') !== '0'; // ?prewarm=0: A/B measurements
let warmed = false;
/** true once the beach programs are warm (tests / probes) */
export const beachPrewarmed = () => warmed;
const idle = (fn: () => void, timeout = 4000) => {
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) { const id = w.requestIdleCallback(fn, { timeout }); return () => w.cancelIdleCallback!(id); }
  const id = setTimeout(fn, 200); return () => clearTimeout(id);
};

/**
 * While the player is in the apartment, once it has settled: mount the beach scene for a few frames in a scene that is
 * never rendered (pointer events off), compile the programs the first beach frame will need, keep them, unmount.
 * Also keeps the apartment's own programs, so coming back does not re-link them. Once per session.
 */
export function BeachPrewarm({ delayMs = 2500 }: { delayMs?: number }) {
  const [on, setOn] = useState(false);
  const hidden = useMemo(() => new THREE.Scene(), []);
  useEffect(() => {
    if (!ENABLED || warmed) return;
    let cancelIdle = () => {}; const t = setTimeout(() => { cancelIdle = idle(() => setOn(true)); }, delayMs);
    return () => { clearTimeout(t); cancelIdle(); };
  }, [delayMs]);
  if (!on || warmed) return null;
  return createPortal(<><BeachAmbience /><BeachView /><WarmWhenMounted hidden={hidden} onDone={() => { warmed = true; setOn(false); }} /></>,
    hidden, { events: { enabled: false } } as never);
}

function WarmWhenMounted({ hidden, onDone }: { hidden: THREE.Scene; onDone: () => void }) {
  const get = useThree((s) => s.get); const root = useThree((s) => s.previousRoot);
  const done = useRef(onDone); done.current = onDone; // a parent re-render must not restart the warm-up
  useEffect(() => {
    const onDone = () => done.current();
    let cancelled = false, raf = 0, frames = 0;
    const step = () => {
      if (cancelled) return;
      if (++frames < 3) { raf = requestAnimationFrame(step); return; } // let the beach run its first useFrames (instance colours, uniforms)
      const { gl, camera } = get(); const main = root?.getState().scene;
      if (!main) { onDone(); return; }
      const apt = main.getObjectByName(APARTMENT_ROOT);
      type Info = { info: { programs?: unknown[] | null } };
      const before = new Set((gl as unknown as Info).info.programs ?? []);
      Promise.all([
        warmPrograms(gl, camera, collectRenderables(hidden), hidden, { clone: true, shadows: true }), // beach scenery
        warmPrograms(gl, camera, collectRenderables(main, (o) => o === apt), hidden, { clone: false, shadows: true }), // avatars & co under the beach lights
        apt ? warmPrograms(gl, camera, collectRenderables(apt), main, { clone: true }) : Promise.resolve(0), // apartment, for the way back
      ]).catch(() => 0).then(() => {
        const fresh = ((gl as unknown as Info).info.programs ?? []).filter((p) => !before.has(p)) as Parameters<typeof finishPrograms>[0];
        if (!cancelled) onDone(); // unmount the hidden beach now; the programs are kept by the retained materials
        // then finish them one per idle slice (independent of this component)
        finishPrograms(fresh, (fn) => { idle(fn, 400); }).then((n) => { (window as unknown as { __beachPrewarm?: unknown }).__beachPrewarm = { programs: n }; });
      });
    };
    raf = requestAnimationFrame(step);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [get, root, hidden]);
  return null;
}
