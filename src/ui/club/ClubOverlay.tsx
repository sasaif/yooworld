import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { club } from '../../app/clubService';
import { CLUB_TABLES } from '../../game/club/clubLayout';
import { gameById, LOCAL_BADGE } from '../../minigames/registry';
import { sameTile, type DominoMove, type DominoView, type Tile } from '../../minigames/dominoes/rules';
import { DominoTile } from './DominoTile';
import { chainLayout } from './chainLayout';
import './club.css';

/**
 * Games Club 2D overlay (landscape first): table setup sheet, the Dominoes table (top strip + line + hand), the
 * "leave the table?" dialog, the round summary and the results screen. The middle of the screen stays free so the
 * seated avatars remain visible in the 3D scene (a transparent layer keeps stray taps from standing the player up).
 * Wording is honest: "Mode local · contre des bots"; nothing is saved and nothing pays Gold / XP.
 */
export function ClubOverlay() {
  const loc = useStore(game.store, (s) => s.location); const setup = useStore(club.store, (s) => s.setup); const ses = useStore(club.store, (s) => s.session);
  useStore(club.store, (s) => s.tick); useStore(club.store, (s) => s.confirmLeave);
  if (loc !== 'club') return null;
  return <>
    {setup && !ses && <SetupSheet tableId={setup} />}
    {ses && ses.phase === 'seating' && <div className="club-hint" data-club="seating">🪑 Je m’installe à la table… <button className="chip" data-club="cancel" onClick={() => club.leave()}>Annuler</button></div>}
    {ses && ses.phase !== 'seating' && <DominoTable />}
  </>;
}

function SetupSheet({ tableId }: { tableId: string }) {
  const t = CLUB_TABLES.find((x) => x.id === tableId)!; const g = gameById(t.gameId)!; const o = useStore(club.store, (s) => s.setupOpts);
  return (
    <div className="sheet club-setup" data-club="setup">
      <h3>{g.icon} {g.name} <span className="club-badge" data-club="badge-setup">{LOCAL_BADGE}</span><button className="x" onClick={() => club.closeSetup()}>✕</button></h3>
      <div className="club-row"><span className="label">Joueurs</span>
        {([2, 3, 4] as const).map((n) => <button key={n} data-players={n} className={'btn' + (o.players === n ? ' primary' : '')} onClick={() => club.setOpts({ players: n })}>{n} <small>toi + {n - 1} bot{n > 2 ? 's' : ''}</small></button>)}
      </div>
      <div className="club-row"><span className="label">Partie</span>
        <button data-mode="single" className={'btn' + (o.mode === 'single' ? ' primary' : '')} onClick={() => club.setOpts({ mode: 'single' })}>1 manche <small>≈ 1–3 min</small></button>
        <button data-mode="points" className={'btn' + (o.mode === 'points' ? ' primary' : '')} onClick={() => club.setOpts({ mode: 'points' })}>Match en 100 points <small>≈ 10–20 min</small></button>
      </div>
      <p className="muted club-rules">Double-six, jeu de la pioche : {o.players === 2 ? '7' : '5'} dominos chacun, le plus gros double ouvre. Pose un domino qui touche un bout de la ligne, sinon pioche (ou passe si la pioche est vide). Sur cet appareil seulement : pas de vrais joueurs, pas d’Or, pas d’XP, rien n’est enregistré.</p>
      <button className="btn primary club-go" data-club="start" onClick={() => club.start()}>🪑 S’asseoir et jouer</button>
    </div>
  );
}

const name = (i: number) => club.s.session?.room.seats[i]?.occupant?.name ?? `Siège ${i + 1}`;
const who = (i: number) => (i === 0 ? 'Toi' : name(i));
const MEDAL = ['🥇', '🥈', '🥉', '4.'];

function DominoTable() {
  const ses = club.s.session!; const host = ses.host; const v = host.view(0); const legal = host.legal(0);
  const [pick, setPick] = useState<Tile | null>(null);
  const myTurn = v.turn === 0 && v.phase === 'playing'; const plays = legal.filter((m): m is Extract<DominoMove, { type: 'play' }> => m.type === 'play');
  const other = legal.find((m) => m.type !== 'play');
  useEffect(() => { setPick(null); }, [host.engine.seq]);
  const tapTile = (t: Tile) => {
    const ms = plays.filter((m) => sameTile(m.tile, t)); if (!ms.length) return;
    if (ms.length === 1) { club.play(ms[0]); return; }
    setPick(pick && sameTile(pick, t) ? null : t);
  };
  const thinking = host.thinking;
  const status = myTurn ? (other?.type === 'draw' ? 'Aucun domino ne va : pioche' : other?.type === 'pass' ? 'Bloqué : passe ton tour' : !v.line.length ? 'Pose ton double pour ouvrir' : pick ? 'Choisis le bout de la ligne' : 'Touche un domino qui brille') : v.turn !== null ? `${name(v.turn)} réfléchit` : '';
  // last tile laid (highlighted on the line)
  const lastRec = [...host.engine.log].reverse().find((r) => r.move !== 'advance' && r.move.type === 'play');
  const fresh = lastRec && lastRec.move !== 'advance' && lastRec.move.type === 'play' ? (lastRec.move.end === 'L' ? 0 : v.line.length - 1) : -1;
  return (
    <div className={'dom' + (myTurn ? ' myturn' : '')} data-club="table" data-turn={v.turn ?? ''} data-phase={v.phase} data-seq={host.engine.seq}>
      <div className="dom-catch" data-club="catch" />
      <div className="dom-top">
        <span className="club-badge" data-club="badge">{LOCAL_BADGE}</span>
        <span className="dom-round">{v.options.mode === 'single' ? 'Manche unique' : `Manche ${v.round} · objectif ${v.options.target}`}</span>
        <div className="dom-players">{v.handCounts.map((n, i) => (
          <span key={i} className={'dom-p' + (v.turn === i && v.phase === 'playing' ? ' turn' : '') + (i === 0 ? ' me' : '')} data-seat={i} data-active={v.turn === i && v.phase === 'playing' ? '1' : '0'}>
            {i === 0 ? '⭐' : '🤖'} {who(i)} <b className="dom-n" title="dominos en main">{n}<i className="dom-ico" /></b>{v.options.mode === 'points' && <em>{v.scores[i]} pts</em>}
            {thinking === i && <span className="dots" data-club="thinking"><i /><i /><i /></span>}
          </span>
        ))}<span className="dom-p bone" data-club="boneyard">Pioche <b>{v.boneyard}</b></span></div>
        <button className="chip dom-quit" data-club="quit" onClick={() => club.requestLeave()}>✕ <span className="dom-quit-l">Quitter</span></button>
      </div>
      <Line v={v} pick={pick} fresh={fresh} onEnd={(end) => { const m = plays.find((x) => pick && sameTile(x.tile, pick) && x.end === end); if (m) club.play(m); }} />
      {myTurn && <div className="dom-cue" key={host.engine.seq} data-club="yourturn">À toi de jouer !</div>}
      {v.phase === 'playing' && <div className={'dom-bottom' + (myTurn ? ' me' : '')}>
        <div className={'dom-status' + (myTurn ? ' me' : '')} data-club="status">{status}{!myTurn && <span className="dots"><i /><i /><i /></span>}</div>
        <div className="dom-hand" data-club="hand">{v.hand.map((t, i) => {
          const ok = myTurn && plays.some((m) => sameTile(m.tile, t));
          return <button key={t.join('-') + i} className={'dom-tile' + (ok ? ' ok' : '') + (pick && sameTile(pick, t) ? ' picked' : '')} disabled={!ok} data-tile={t.join('-')} onClick={() => tapTile(t)}><DominoTile a={t[0]} b={t[1]} size={22} vertical dim={myTurn && !ok} /></button>;
        })}</div>
        {myTurn && other && <button className="btn primary dom-act" data-club={other.type} onClick={() => club.play(other)}>{other.type === 'draw' ? `🂠 Piocher (${v.boneyard})` : '⏭️ Passer'}</button>}
      </div>}
      {v.phase === 'roundOver' && ses.phase === 'playing' && <RoundSummary />}
      {ses.phase === 'results' && <Results />}
      {club.s.confirmLeave && <LeaveConfirm />}
    </div>
  );
}

function Line({ v, pick, fresh, onEnd }: { v: DominoView; pick: Tile | null; fresh: number; onEnd: (e: 'L' | 'R') => void }) {
  const wrap = useRef<HTMLDivElement>(null); const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = wrap.current; if (!el) return; const upd = () => setW(el.clientWidth); upd();
    const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
  }, []);
  // room kept for the two end buttons at all times, so tiles never jump when a tile is picked
  const short = typeof innerHeight === 'number' && innerHeight < 385; // iPhone SE landscape: keep the strip low over the table
  const L = chainLayout(v.line, Math.max(160, w - 16 - 2 * 62), short ? { max: 19, pref: 17, min: 16, maxRows: 3 } : { max: 22, pref: 18, min: 16, maxRows: 3 });
  const last = v.line.length - 1; const canL = !!pick && v.ends !== null; 
  return (
    <div className="dom-line" ref={wrap} data-club="line" data-len={v.line.length} data-size={L.size} data-rows={L.rows.length}>
      <div className="dom-endslot">{canL && <button className="btn dom-end e-l" data-end="L" onClick={() => onEnd('L')}>◀ {v.ends?.[0]}</button>}</div>
      <div className={'dom-chain' + (L.fits ? '' : ' scroll')} data-club="chain">
        {v.line.length ? <div className="dom-rows" style={{ width: L.width }}>{L.rows.map((r, k) => (
          <div key={k} className={'dom-row' + (r.reverse ? ' rev' : '')} style={{ gap: 2 }}>
            {r.cells.map((c) => (
              <span key={c.idx} className={'dom-cell' + (c.idx === 0 ? ' end-l' : '') + (c.idx === last ? ' end-r' : '') + (c.idx === fresh ? ' fresh' : '') + (pick && (c.idx === 0 || c.idx === last) ? ' target' : '')} data-idx={c.idx}
                onClick={pick ? () => { if (c.idx === 0) onEnd('L'); else if (c.idx === last) onEnd('R'); } : undefined}>
                <DominoTile a={c.a} b={c.b} size={L.size} vertical={c.double} />
              </span>
            ))}
          </div>
        ))}</div> : <span className="dom-empty">La ligne est vide : le plus gros double ouvre</span>}
      </div>
      <div className="dom-endslot">{canL && <button className="btn dom-end e-r" data-end="R" onClick={() => onEnd('R')}>{v.ends?.[1]} ▶</button>}</div>
    </div>
  );
}

function LeaveConfirm() {
  return (
    <div className="dom-modal-bg confirm-bg" data-club="leave-confirm">
      <div className="dom-modal confirm">
        <h3>Quitter la table ?</h3>
        <p>La partie en cours sera abandonnée. Rien n’est perdu : pas d’Or, pas d’XP, rien n’est enregistré.</p>
        <div className="row"><button className="btn" data-club="stay" onClick={() => club.cancelLeave()}>Rester</button><button className="btn primary" data-club="leave-yes" onClick={() => club.leave()}>🚪 Quitter</button></div>
      </div>
    </div>
  );
}

function RoundSummary() {
  const v = club.s.session!.host.view(0); const r = v.lastRound!;
  return (
    <div className="dom-modal-bg"><div className="dom-modal" data-club="round">
      <h3>Fin de la manche {r.round}</h3>
      <p>{r.winner === null ? '🤝 Jeu bloqué, égalité : personne ne marque.' : `${r.winner === 0 ? '🎉 Tu gagnes' : name(r.winner) + ' gagne'} la manche${r.reason === 'blocked' ? ' (jeu bloqué)' : ' (Domino !)'} : +${r.points} points.`}</p>
      <Scores scores={v.scores} pips={r.pips} target={v.options.target} />
      <button className="btn primary" data-club="next" onClick={() => club.nextRound()}>Manche suivante ▶</button>
    </div></div>
  );
}
function Scores({ scores, pips, ranking, target }: { scores: number[]; pips?: number[]; ranking?: number[]; target?: number }) {
  const order = ranking ?? scores.map((_, i) => i);
  return <table className="dom-scores"><tbody>{order.map((i, k) => (
    <tr key={i} className={i === 0 ? 'me' : ''} data-rank-seat={i}>
      <td className="rk">{ranking ? MEDAL[k] : ''}</td><td>{i === 0 ? '⭐ Toi' : `🤖 ${name(i)}`}</td>
      <td className="pts">{scores[i]} pts{target ? <span className="bar"><i style={{ width: `${Math.min(100, scores[i] / target * 100)}%` }} /></span> : null}</td>
      {pips && <td className="muted">{pips[i]} en main</td>}
    </tr>))}</tbody></table>;
}
const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
function Results() {
  const ses = club.s.session!; const res = ses.host.result!; const rounds = ses.host.state.rounds; const last = rounds[rounds.length - 1];
  const won = res.winners.includes(0); const draw = res.endedBy === 'normal' && res.winners.length === 0;
  const head = res.endedBy !== 'normal' ? 'Partie abandonnée' : won ? (res.winners.length > 1 ? '🤝 Égalité en tête !' : '🏆 Tu gagnes !') : draw ? '🤝 Égalité : jeu bloqué' : `${name(res.winners[0])} gagne`;
  const n = ses.room.seats.length; const mode = ses.host.state.options.mode;
  return (
    <div className="dom-modal-bg"><div className={'dom-modal results' + (won ? ' won' : '')} data-club="results" data-won={won ? '1' : '0'}>
      <h3>{head}</h3>
      {last && <p className="muted">{last.reason === 'domino' ? `Domino ! ${last.winner === 0 ? 'Tu as' : name(last.winner!) + ' a'} posé son dernier domino.` : last.winner === null ? 'Jeu bloqué : égalité sur le moins de points en main, personne ne marque.' : 'Jeu bloqué : le moins de points en main l’emporte.'}</p>}
      <div className="res-grid">
        <Scores scores={res.scores} pips={last?.pips} ranking={res.ranking} />
        <div className="res-side">
          <div className="res-meta" data-club="recap-meta">{n} joueurs · {mode === 'single' ? '1 manche' : `match en ${ses.host.state.options.target} points`} · {res.moves} coups · {mmss(res.durationMs)}</div>
          {rounds.length > 0 && <table className="dom-recap" data-club="recap"><tbody>{rounds.map((r) => (
            <tr key={r.round}><td>M{r.round}</td><td>{r.winner === null ? 'nulle' : who(r.winner)}</td><td>{r.reason === 'domino' ? 'Domino !' : 'bloqué'}</td><td>+{r.points}</td></tr>
          ))}</tbody></table>}
        </div>
      </div>
      <p className="muted small">{LOCAL_BADGE}. Résultat gardé pour cette session seulement : pas d’Or, pas d’XP, pas de statistiques enregistrées.</p>
      <div className="row">
        <button className="btn primary" data-club="replay" onClick={() => club.replay()}>🔁 Rejouer <small>même table</small></button>
        <button className="btn" data-club="change" onClick={() => club.changeGame()}>⚙️ Changer de partie</button>
        <button className="btn" data-club="leave" onClick={() => club.leave()}>🚪 Quitter</button>
      </div>
    </div></div>
  );
}
