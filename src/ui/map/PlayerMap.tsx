import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { PLAYER_MAP, PLAYER_MAP_PLACES, PLAYER_MAP_UI, MAP_STATUS, canVisit, mapPlaceById, visitLabel, type MapPlace } from '../../data/playerMap';
import { camToPoint, clampCam, fitCam, maxScale, pctToPx, zoomAt, type Cam } from './mapCamera';
import './playerMap.css';

const MW = PLAYER_MAP.width, MH = PLAYER_MAP.height;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Full-city player map (Alessandro's illustration). Replaces the Lieux list when panel === 'places'.
 * Visiter calls game.travelWithFade for open, built places only (Mon appart, Yoo Plage).
 */
export function PlayerMap() {
  const loc = useStore(game.store, (s) => s.location);
  const panel = useStore(game.store, (s) => s.panel);
  const transition = useStore(game.store, (s) => s.transition);
  const [visible, setVisible] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const cam = useRef<Cam>({ x: 0, y: 0, s: 1 });
  const leaving = useRef(false);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ mid: { x: number; y: number }; dist: number } | null>(null);
  const moved = useRef(false);
  const suppress = useRef(false);

  const viewSize = () => ({ w: view.current?.clientWidth ?? 0, h: view.current?.clientHeight ?? 0 });
  const apply = useCallback((c: Cam) => {
    const { w, h } = viewSize();
    cam.current = clampCam(c, w, h, MW, MH);
    const el = world.current; if (!el) return;
    el.style.transform = `translate(${cam.current.x}px,${cam.current.y}px) scale(${cam.current.s})`;
    el.style.setProperty('--zs', String(cam.current.s));
    // keep hit targets ≥ 44 CSS px
    const z = cam.current.s;
    for (const p of PLAYER_MAP_PLACES) {
      const b = el.querySelector<HTMLElement>(`[data-map-place="${p.id}"]`); if (!b) continue;
      const bw = pctToPx(p.hit.w, MW), bh = pctToPx(p.hit.h, MH), min = 44 / z;
      const ew = Math.max(bw, min), eh = Math.max(bh, min);
      b.style.width = `${ew}px`; b.style.height = `${eh}px`;
      b.style.left = `${pctToPx(p.hit.x, MW) - (ew - bw) / 2}px`;
      b.style.top = `${pctToPx(p.hit.y, MH) - (eh - bh) / 2}px`;
    }
    // Expand baked chrome to ≥ 44 CSS px without letting + and − overlap
    // (they sit one above the other; a uniform min-size at city-fit scale would collide).
    const min = 44 / z;
    const zin = el.querySelector<HTMLElement>('[data-map="zin"]');
    const zout = el.querySelector<HTMLElement>('[data-map="zout"]');
    const close = el.querySelector<HTMLElement>('[data-map="close"]');
    if (zin) {
      const h = Math.max(PLAYER_MAP_UI.hits.zoomIn.h, min);
      zin.style.width = `${Math.max(PLAYER_MAP_UI.hits.zoomIn.w, min)}px`;
      zin.style.height = `${h}px`;
      zin.style.top = `${PLAYER_MAP_UI.hits.zoomIn.y + PLAYER_MAP_UI.hits.zoomIn.h - h}px`;
    }
    if (zout) {
      zout.style.width = `${Math.max(PLAYER_MAP_UI.hits.zoomOut.w, min)}px`;
      zout.style.height = `${Math.max(PLAYER_MAP_UI.hits.zoomOut.h, min)}px`;
      zout.style.top = `${PLAYER_MAP_UI.hits.zoomOut.y}px`;
    }
    if (close) {
      close.style.minWidth = `${min}px`; close.style.minHeight = `${min}px`;
    }
    const here = el.querySelector<HTMLElement>('[data-map="here"]');
    if (here) here.style.transform = `translate(-50%,-100%) scale(${Math.min(1, 0.72 / z)})`;
  }, []);

  const fit = useCallback(() => {
    const { w, h } = viewSize(); if (!w || !h) return fitCam(1, 1, MW, MH);
    return fitCam(w, h, MW, MH);
  }, []);

  useEffect(() => {
    if (panel !== 'places') {
      if (!transition) leaving.current = false;
      setVisible(false); setSelected(null);
      return;
    }
    leaving.current = false;
    const id = requestAnimationFrame(() => { apply(fit()); setVisible(true); });
    return () => cancelAnimationFrame(id);
  }, [panel, apply, fit, transition]);

  useEffect(() => {
    const onResize = () => { if (panel === 'places') apply(fit()); };
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, [panel, apply, fit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || panel !== 'places') return;
      if (selected) setSelected(null); else game.setPanel(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [panel, selected]);

  const zoomBy = (f: number) => {
    const r = view.current?.getBoundingClientRect(); if (!r) return;
    const f0 = fit();
    const next = zoomAt(cam.current, r.width / 2, r.height / 2, cam.current.s * f, f0.s, maxScale(f0));
    animate(clampCam(next, r.width, r.height, MW, MH), 260);
  };

  const animate = (to: Cam, ms: number) => new Promise<void>((res) => {
    if (reduced() || ms <= 0) { apply(to); res(); return; }
    const from = { ...cam.current }, t0 = performance.now();
    const st = (n: number) => {
      const t = Math.min(1, (n - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      apply({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, s: from.s + (to.s - from.s) * e });
      if (t < 1) requestAnimationFrame(st); else res();
    };
    requestAnimationFrame(st);
  });

  const onDown = (e: React.PointerEvent) => {
    if (e.button) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    view.current?.classList.add('grabbing');
    if (ptrs.current.size === 2) {
      const p = [...ptrs.current.values()];
      pinch.current = { mid: { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 }, dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const pr = ptrs.current.get(e.pointerId); if (!pr) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { w, h } = viewSize(); const f0 = fit();
    if (ptrs.current.size === 1) {
      const dx = e.clientX - pr.x, dy = e.clientY - pr.y;
      if (Math.hypot(dx, dy) > 2) moved.current = true;
      apply({ x: cam.current.x + dx, y: cam.current.y + dy, s: cam.current.s });
    } else if (ptrs.current.size === 2 && pinch.current) {
      const p = [...ptrs.current.values()], mid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      const r = view.current!.getBoundingClientRect();
      const zoomed = zoomAt(cam.current, mid.x - r.left, mid.y - r.top, cam.current.s * d / (pinch.current.dist || d), f0.s, maxScale(f0));
      apply(clampCam({ s: zoomed.s, x: zoomed.x + mid.x - pinch.current.mid.x, y: zoomed.y + mid.y - pinch.current.mid.y }, w, h, MW, MH));
      pinch.current = { mid, dist: d };
      moved.current = true;
    }
  };
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (!ptrs.current.size) { view.current?.classList.remove('grabbing'); pinch.current = null; }
    if (moved.current) { suppress.current = true; setTimeout(() => { suppress.current = false; }, 60); }
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const r = view.current!.getBoundingClientRect(); const f0 = fit();
    const next = zoomAt(cam.current, e.clientX - r.left, e.clientY - r.top, cam.current.s * (e.deltaY > 0 ? 0.9 : 1.11), f0.s, maxScale(f0));
    apply(clampCam(next, r.width, r.height, MW, MH));
  };

  const openSheet = (id: string) => {
    if (suppress.current) return;
    setFlash(id); setTimeout(() => setFlash((x) => x === id ? null : x), 260);
    setSelected(id);
  };
  const visit = async (p: MapPlace) => {
    if (!p.travel || !canVisit(p, loc)) return;
    setSelected(null);
    leaving.current = true;
    const { w, h } = viewSize(); const f0 = fit();
    if (!reduced()) await animate(clampCam(camToPoint(p.anchor.x, p.anchor.y, Math.min(maxScale(f0), f0.s * 2.6), w, h, MW, MH), w, h, MW, MH), 700);
    game.travelWithFade(p.travel);
  };

  const here = mapPlaceById(loc) ?? PLAYER_MAP_PLACES.find((p) => p.travel === loc);
  const ui = PLAYER_MAP_UI.hits;
  const place = selected ? mapPlaceById(selected) : undefined;
  const shown = panel === 'places' || (leaving.current && !!transition);

  if (!shown && !visible) return null;

  return (
    <div className={'pmap' + (panel === 'places' || leaving.current ? ' open' : '') + (visible ? ' visible' : '') + (place ? ' sheet-open' : '')} role="dialog" aria-label="Carte de YooWorld" aria-modal="true" data-map="root">
      <div ref={view} className="pmap-view" data-map="view" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel} onClick={() => { if (!suppress.current) setSelected(null); }}>
        <div ref={world} className="pmap-world" style={{ width: MW, height: MH }}>
          <img className="map" src={PLAYER_MAP.src} width={MW} height={MH} alt="Carte illustrée de YooWorld" draggable={false} />
          {PLAYER_MAP_PLACES.map((p) => (
            <button key={p.id} type="button" className={'pmap-hs' + (flash === p.id || selected === p.id ? ' flash' : '') + (selected === p.id ? ' active' : '')} data-map-place={p.id} aria-label={`${p.name} — ${MAP_STATUS[p.status].label}`}
              style={{ left: pctToPx(p.hit.x, MW), top: pctToPx(p.hit.y, MH), width: pctToPx(p.hit.w, MW), height: pctToPx(p.hit.h, MH) }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); openSheet(p.id); }} />
          ))}
          {PLAYER_MAP_PLACES.map((p) => (
            <span key={'dot-' + p.id} className={'pmap-dot ' + p.status} data-map-dot={p.id} style={{ left: pctToPx(p.dot.x, MW), top: pctToPx(p.dot.y, MH) }} />
          ))}
          {here && (
            <div className="pmap-here" data-map="here" style={{ left: pctToPx(here.anchor.x, MW), top: pctToPx(here.anchor.y, MH), transform: 'translate(-50%,-100%)' }}>
              <span className="ring" /><span className="face" /><span className="tag">Toi</span>
            </div>
          )}
          <button type="button" className="pmap-ui" data-map="close" aria-label="Fermer la carte" style={{ left: ui.close.x, top: ui.close.y, width: ui.close.w, height: ui.close.h }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); game.setPanel(null); }} />
          <button type="button" className="pmap-ui" data-map="zin" aria-label="Zoomer" style={{ left: ui.zoomIn.x, top: ui.zoomIn.y, width: ui.zoomIn.w, height: ui.zoomIn.h }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); zoomBy(1.4); }} />
          <button type="button" className="pmap-ui" data-map="zout" aria-label="Dézoomer" style={{ left: ui.zoomOut.x, top: ui.zoomOut.y, width: ui.zoomOut.w, height: ui.zoomOut.h }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); zoomBy(1 / 1.4); }} />
        </div>
      </div>
      <div className="pmap-legend" aria-hidden="true"><span><i className="o" />Ouvert</span><span><i className="j" />Jalon 1</span><span><i className="s" />Bientôt</span></div>
      {place && (
        <aside className="pmap-sheet show" data-map="card" aria-live="polite">
          <img className="preview" src={place.thumb} alt={`Aperçu de ${place.name}`} />
          <div className="meta">
            <h2>{place.icon} {place.name} <span className={'pmap-tag ' + MAP_STATUS[place.status].cls}>{MAP_STATUS[place.status].label}</span></h2>
            <p className="blurb">{place.blurb}{place.inside ? ' · ' + place.inside : ''}</p>
          </div>
          <div className="actions">
            <button type="button" className="x" data-map="card-x" aria-label="Fermer la fiche" onClick={() => setSelected(null)}>✕</button>
            <button type="button" className={'pmap-go' + (place.travel === loc && place.status === 'open' ? ' here' : '')} data-map="go" disabled={!canVisit(place, loc)} onClick={() => visit(place)}>
              {visitLabel(place, loc)}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
