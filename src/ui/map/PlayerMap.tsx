import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import {
  PLAYER_MAP, PLAYER_MAP_DISTRICTS, MAP_STATUS, canVisit, districtById, featuredPlaces, placeForLocation, placesIn, visitLabel,
  type DistrictId, type MapPlace, type Pct,
} from '../../data/playerMap';
import { camToRect, clampCam, fitCam, L2_TOP, l2Strip, type Cam } from './mapCamera';
import { CITY_NAV, mapNavigation } from './mapNavigation';
import { placeBoxes, type Box, type Nudge } from './mapLayout';
import './playerMap.css';

const MW = PLAYER_MAP.width, MH = PLAYER_MAP.height;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const forceBaked = () => typeof location !== 'undefined' && new URLSearchParams(location.search).get('mapart') === 'baked';

/**
 * Two-level city map (YoLand). Level 1: the illustrated city with 6 district badges, the Usine / Ferme pins and "Toi".
 * Level 2 (tap a district): the art framed on that district + a strip of location cards with status and Visiter.
 * No free pan / zoom. Visiter calls game.travelWithFade for playable places only (Mon appart, Yoo Plage, Yoo Games Club).
 * All text, markers and controls are UI; the art is the clean (text-free) illustration, with the original art as fallback.
 */
export function PlayerMap() {
  const loc = useStore(game.store, (s) => s.location);
  const panel = useStore(game.store, (s) => s.panel);
  const transition = useStore(game.store, (s) => s.transition);
  const [visible, setVisible] = useState(false);
  const [{ district, selected }, dispatch] = useReducer(mapNavigation, CITY_NAV);
  const setSelected = (id: string | null) => dispatch({ type: 'select', id });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [baked, setBaked] = useState(forceBaked);
  const view = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState<Record<string, Nudge>>({});

  const measure = useCallback(() => {
    const el = view.current; if (!el) return;
    setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
  }, []);

  useEffect(() => {
    if (panel !== 'places') {
      if (!transition) leaving.current = false;
      setVisible(false); dispatch({ type: 'city' });
      return;
    }
    leaving.current = false;
    const id = requestAnimationFrame(() => { measure(); setVisible(true); });
    return () => cancelAnimationFrame(id);
  }, [panel, transition, measure]);

  useEffect(() => {
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, [measure]);
  useLayoutEffect(measure);

  const openDistrict = (id: DistrictId, selected: string | null = null) => dispatch({ type: 'district', id, selected });
  const backToCity = () => dispatch({ type: 'city' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || panel !== 'places') return;
      if (district) backToCity(); else game.setPanel(null);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [panel, district]);

  useEffect(() => {
    if (!selected) return;
    strip.current?.querySelector<HTMLElement>(`[data-map-card="${selected}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  }, [selected, district]);

  const visit = (p: MapPlace) => {
    if (!p.travel || !canVisit(p, loc)) return;
    leaving.current = true;
    game.travelWithFade(p.travel);
  };

  const { w: vw, h: vh } = size;
  const d = district ? districtById(district) : undefined;
  let cam: Cam = fitCam(vw || 1, vh || 1, MW, MH);
  if (d && vw && vh) {
    const fit = cam, stripH = l2Strip(vw, vh);
    cam = clampCam(camToRect(d.focus, { x: 0, y: L2_TOP, w: vw, h: vh - L2_TOP - stripH }, MW, MH, Math.min(1, fit.s * 2.2), fit.s), vw, vh - stripH, MW, MH);
  }
  const at = (p: Pct) => ({ left: cam.x + (p.x / 100) * MW * cam.s, top: cam.y + (p.y / 100) * MH * cam.s });
  const here = placeForLocation(loc);
  const places = d ? placesIn(d.id) : [];
  const cards = places.filter((p) => p.status !== 'future');
  const future = places.filter((p) => p.status === 'future');
  const shown = panel === 'places' || (leaving.current && !!transition);
  const layoutKey = `${vw}x${vh}|${district}|${selected}|${loc}|${shown}|${visible}|${baked}`;
  // Keep badges / pins / "Toi" readable and tappable: inside the view, off the ✕ / title / tabs / card strip, never
  // on top of each other. Positions come from layout boxes (offset*), so the opening scale animation does not skew them.
  useLayoutEffect(() => {
    const r = root.current; if (!r || !vw || !vh) return;
    const box = (el: HTMLElement, ay: number): Box => ({ x: el.offsetLeft - el.offsetWidth / 2, y: el.offsetTop - el.offsetHeight * ay, w: el.offsetWidth, h: el.offsetHeight });
    const fixed: Box[] = [];
    r.querySelectorAll<HTMLElement>('.pmap-top > *').forEach((el) => {
      const p = el.offsetParent as HTMLElement | null;
      fixed.push({ x: (p?.offsetLeft ?? 0) + el.offsetLeft, y: (p?.offsetTop ?? 0) + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    });
    const st = r.querySelector<HTMLElement>('.pmap-strip'); if (st) fixed.push({ x: 0, y: st.offsetTop, w: vw, h: st.offsetHeight });
    const els = [...r.querySelectorAll<HTMLElement>('[data-map-district], [data-map-pin], .pmap-layer [data-map-place]')];
    const here = r.querySelector<HTMLElement>('[data-map="here"]');
    const items = els.map((el) => box(el, 0.5));
    if (here) { els.push(here); items.push(box(here, 1)); }
    const ns = placeBoxes(items, fixed, { w: vw, h: vh }, 6);
    const next: Record<string, Nudge> = {};
    els.forEach((el, i) => { const k = el.dataset.mapDistrict ?? el.dataset.mapPin ?? el.dataset.mapPlace ?? 'here'; if (ns[i].dx || ns[i].dy) next[(el.dataset.mapDistrict ? 'd:' : el.dataset.mapPin ? 'p:' : el.dataset.mapPlace ? 'l:' : '') + k] = ns[i]; });
    setNudge((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
  }, [layoutKey]);
  const nv = (k: string) => { const n = nudge[k]; return n ? ({ '--dx': `${n.dx}px`, '--dy': `${n.dy}px` } as React.CSSProperties) : undefined; };
  if (!shown && !visible) return null;

  return (
    <div ref={root} className={'pmap' + (panel === 'places' || leaving.current ? ' open' : '') + (visible ? ' visible' : '') + (d ? ' l2' : ' l1') + (cards.length <= 2 ? ' few' : '')}
      role="dialog" aria-label="Carte de YoLand" aria-modal="true" data-map="root" data-map-level={d ? 2 : 1} data-map-art={baked ? 'baked' : 'clean'}>
      <div ref={view} className="pmap-view" data-map="view" onClick={() => setSelected(null)}>
        <div className="pmap-world" style={{ width: MW, height: MH, transform: `translate(${cam.x}px,${cam.y}px) scale(${cam.s})` }}>
          <img className="map" src={baked ? PLAYER_MAP.fallback : PLAYER_MAP.src} width={MW} height={MH} alt="Carte illustrée de YoLand" draggable={false}
            onError={() => { if (!baked) setBaked(true); }} />
        </div>
        <div className="pmap-layer" key={d ? 'l2-' + d.id : 'l1'}>
          {!d && PLAYER_MAP_DISTRICTS.map((x) => x.zones.map((z, i) => (
            <button key={x.id + i} type="button" className="pmap-zone" data-map-zone={x.id} aria-label={`Quartier ${x.name}`} tabIndex={-1}
              style={{ ...at(z), width: (z.w / 100) * MW * cam.s, height: (z.h / 100) * MH * cam.s }}
              onClick={(e) => { e.stopPropagation(); openDistrict(x.id); }} />
          )))}
          {!d && PLAYER_MAP_DISTRICTS.map((x) => (
            <button key={x.id} type="button" className="pmap-badge" data-map-district={x.id} style={{ ...at(x.badge), ...nv('d:' + x.id) }}
              onClick={(e) => { e.stopPropagation(); openDistrict(x.id); }}>
              <span className="i" aria-hidden="true">{x.icon}</span>{x.name}
            </button>
          ))}
          {!d && featuredPlaces().map((p) => (
            <button key={p.id} type="button" className="pmap-feat" data-map-pin={p.id} style={{ ...at(p.label), ...nv('p:' + p.id) }} aria-label={`${p.name} — ${MAP_STATUS[p.status].label}`}
              onClick={(e) => { e.stopPropagation(); openDistrict(p.district, p.id); }}>
              <span className="i" aria-hidden="true">{p.icon}</span>
              <span className="t">{p.name} · {MAP_STATUS[p.status].label}</span>
            </button>
          ))}
          {d && cards.map((p) => (
            <button key={p.id} type="button" className={'pmap-pin ' + MAP_STATUS[p.status].cls + (selected === p.id ? ' active' : '')} data-map-place={p.id} style={{ ...at(p.label), ...nv('l:' + p.id) }} aria-label={`${p.name} — ${MAP_STATUS[p.status].label}`}
              onClick={(e) => { e.stopPropagation(); setSelected(p.id); }}>
              <span className="i" aria-hidden="true">{p.icon}</span><span className="n">{p.name}</span><i className="dot" aria-hidden="true" />
            </button>
          ))}
          {here && (!d || here.district === d.id) && (
            <div className="pmap-here" data-map="here" style={{ ...at(here.anchor), ...nv('here') }}>
              <span className="ring" /><span className="face" /><span className="tag">Toi</span>
            </div>
          )}
        </div>
      </div>

      <div className="pmap-top">
        {d ? <>
          <button type="button" className="pmap-back" data-map="back" onClick={backToCity} aria-label="Retour à la ville">‹ Ville</button>
          <nav className="pmap-tabs" aria-label="Quartiers">
            {PLAYER_MAP_DISTRICTS.map((x) => (
              <button key={x.id} type="button" aria-label={x.name} data-map-tab={x.id} className={x.id === d.id ? 'on' : ''} aria-pressed={x.id === d.id} onClick={() => openDistrict(x.id)}>
                <span aria-hidden="true">{x.icon}</span><span className="tn"> {x.name}</span>
              </button>
            ))}
          </nav>
        </> : (
          <div className="pmap-title" data-map="title"><b>Carte de YoLand</b><span>Choisis un quartier</span></div>
        )}
        <button type="button" className="pmap-close" data-map="close" aria-label="Fermer la carte" onClick={() => game.setPanel(null)}>✕</button>
      </div>

      {d && (
        <div ref={strip} className="pmap-strip" data-map="strip" onClick={(e) => e.stopPropagation()}>
          {cards.map((p) => {
            const here = p.status === 'playable' && p.travel === loc;
            return (
              <article key={p.id} className={'pmap-card' + (selected === p.id ? ' active' : '')} data-map-card={p.id} onClick={() => setSelected(p.id)}>
                <img src={p.thumb} alt="" loading="lazy" />
                <div className="meta">
                  <h3>{p.icon} {p.name}</h3>
                  <span className={'pmap-tag ' + MAP_STATUS[p.status].cls}>{MAP_STATUS[p.status].label}</span>
                  <p>{p.blurb}</p>
                </div>
                <button type="button" className={'pmap-go' + (here ? ' here' : '')} data-map-go={p.id} disabled={!canVisit(p, loc)}
                  onClick={(e) => { e.stopPropagation(); visit(p); }}>{visitLabel(p, loc)}</button>
              </article>
            );
          })}
          {future.length > 0 && (
            <div className="pmap-future" data-map="future">
              <b>Extension future</b>
              <span>{future.map((p) => `${p.icon} ${p.name}`).join(' · ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
