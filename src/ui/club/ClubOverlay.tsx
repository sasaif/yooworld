import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { club, game } from '../../app/services';
import { CLUB_TABLES } from '../../game/club/clubLayout';
import { gameById, LOCAL_BADGE } from '../../minigames/registry';
import { dominoes, sameTile, type DominoMove, type Tile } from '../../minigames/dominoes/rules';
import { DominoTile } from './DominoTile';
import './club.css';

/**
 * Games Club 2D overlay (landscape first): table setup sheet, the Dominoes table (top strip + line + hand) and the results
 * screen. The middle of the screen stays free so the seated avatar remains visible in the 3D scene.
 * Wording is honest: "Mode local · contre des bots"; nothing is saved and nothing pays Gold / XP.
 */
export function ClubOverlay() {
  const loc = useStore(game.store, (s) => s.location); const setup = useStore(club.store, (s) => s.setup); const ses = useStore(club.store, (s) => s.session);
  useStore(club.store, (s) => s.tick);
  if (loc !== 'club') return null;
  return <>
    {setup && !ses && <SetupSheet tableId={setup} />}
    {ses && ses.phase === 'seating' && <div className="club-hint">🪑 Je m’installe à la table…</div>}
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
        <button data-mode="single" className={'btn' + (o.mode === 'single' ? ' primary' : '')} onClick={() => club.setOpts({ mode: 'single' })}>1 manche</button>
        <button data-mode="points" className={'btn' + (o.mode === 'points' ? ' primary' : '')} onClick={() => club.setOpts({ mode: 'points' })}>Match en 100 points</button>
      </div>
      <p className="muted club-rules">Double-six, jeu de la pioche : pose un domino qui touche un bout de la ligne, sinon pioche (ou passe si la pioche est vide). Sur cet appareil seulement : pas de vrais joueurs, pas d’Or, pas d’XP, rien n’est enregistré.</p>
      <button className="btn primary club-go" data-club="start" onClick={() => club.start()}>🪑 S’asseoir et jouer</button>
    </div>
  );
}

const name = (i: number) => club.s.session?.room.seats[i]?.occupant?.name ?? `Siège ${i + 1}`;

function DominoTable() {
  const ses = club.s.session!; const host = ses.host; const v = host.view(0); const legal = host.legal(0);
  const [pick, setPick] = useState<Tile | null>(null);
  const myTurn = v.turn === 0; const plays = legal.filter((m): m is Extract<DominoMove, { type: 'play' }> => m.type === 'play');
  const other = legal.find((m) => m.type !== 'play');
  useEffect(() => { setPick(null); }, [host.engine.seq]);
  const tapTile = (t: Tile) => {
    const ms = plays.filter((m) => sameTile(m.tile, t)); if (!ms.length) return;
    if (ms.length === 1) { club.play(ms[0]); return; }
    setPick(t);
  };
  const status = v.phase === 'matchOver' ? 'Partie terminée' : v.phase === 'roundOver' ? 'Fin de la manche' : myTurn ? (other?.type === 'draw' ? 'Aucun domino ne va : pioche' : other?.type === 'pass' ? 'Bloqué : passe ton tour' : !v.line.length ? 'À toi : pose ton double pour ouvrir' : 'À toi de jouer') : `${name(v.turn!)} réfléchit…`;
  return (
    <div className="dom" data-club="table" data-turn={v.turn ?? ''} data-phase={v.phase} data-seq={host.engine.seq}>
      <div className="dom-top">
        <span className="club-badge" data-club="badge">{LOCAL_BADGE}</span>
        <span className="dom-round">{v.options.mode === 'single' ? 'Manche unique' : `Manche ${v.round} · objectif ${v.options.target}`}</span>
        <div className="dom-players">{v.handCounts.map((n, i) => (
          <span key={i} className={'dom-p' + (v.turn === i ? ' turn' : '') + (i === 0 ? ' me' : '')} data-seat={i}>{i === 0 ? '⭐' : '🤖'} {i === 0 ? 'Toi' : name(i)} <b className="dom-n" title="dominos en main">{n}<i className="dom-ico" /></b>{v.options.mode === 'points' && <em>{v.scores[i]} pts</em>}</span>
        ))}<span className="dom-p bone" data-club="boneyard">Pioche <b>{v.boneyard}</b></span></div>
        <button className="chip dom-quit" data-club="quit" onClick={() => { if (v.phase !== 'playing' || confirm('Quitter la table ? La partie en cours sera abandonnée.')) club.leave(); }}>✕ <span className="dom-quit-l">Quitter</span></button>
      </div>
      <Line v={v} pick={pick} onEnd={(end) => { const m = plays.find((x) => pick && sameTile(x.tile, pick) && x.end === end); if (m) club.play(m); }} />
      {v.phase === 'playing' && <div className="dom-bottom">
        <div className={'dom-status' + (myTurn ? ' me' : '')} data-club="status">{status}</div>
        <div className="dom-hand" data-club="hand">{v.hand.map((t, i) => {
          const ok = myTurn && plays.some((m) => sameTile(m.tile, t));
          return <button key={t.join('-') + i} className={'dom-tile' + (ok ? ' ok' : '') + (pick && sameTile(pick, t) ? ' picked' : '')} disabled={!ok} data-tile={t.join('-')} onClick={() => tapTile(t)}><DominoTile a={t[0]} b={t[1]} size={22} vertical dim={myTurn && !ok} /></button>;
        })}</div>
        {myTurn && other && <button className="btn primary dom-act" data-club={other.type} onClick={() => club.play(other)}>{other.type === 'draw' ? `🂠 Piocher (${v.boneyard})` : '⏭️ Passer'}</button>}
      </div>}
      {v.phase === 'roundOver' && <RoundSummary />}
      {ses.phase === 'results' && <Results />}
    </div>
  );
}

function Line({ v, pick, onEnd }: { v: ReturnType<typeof dominoes.viewFor>; pick: Tile | null; onEnd: (e: 'L' | 'R') => void }) {
  const wrap = useRef<HTMLDivElement>(null); const [size, setSize] = useState(18);
  // fit the whole line in the strip: tile size shrinks as the line grows (min 9 px), never hides a tile
  useLayoutEffect(() => {
    const w = (wrap.current?.clientWidth ?? 600) - (pick ? 120 : 16); const units = v.line.reduce((n, t) => n + (t.a === t.b ? 1 : 2), 0) || 1;
    setSize(Math.max(9, Math.min(20, Math.floor(w / (units + v.line.length * 0.12)))));
  }, [v.line.length, pick]);
  return (
    <div className="dom-line" ref={wrap} data-club="line" data-len={v.line.length}>
      {pick && <button className="btn dom-end" data-end="L" onClick={() => onEnd('L')}>◀ {v.ends?.[0]}</button>}
      <div className="dom-chain">{v.line.length ? v.line.map((t, i) => <DominoTile key={i} a={t.a} b={t.b} size={size} vertical={t.a === t.b} />) : <span className="dom-empty">La ligne est vide</span>}</div>
      {pick && <button className="btn dom-end" data-end="R" onClick={() => onEnd('R')}>{v.ends?.[1]} ▶</button>}
    </div>
  );
}

function RoundSummary() {
  const v = club.s.session!.host.view(0); const r = v.lastRound!;
  return (
    <div className="dom-modal" data-club="round">
      <h3>Fin de la manche {r.round}</h3>
      <p>{r.winner === null ? 'Jeu bloqué, égalité : personne ne marque.' : `${r.winner === 0 ? 'Tu gagnes' : name(r.winner) + ' gagne'} la manche${r.reason === 'blocked' ? ' (jeu bloqué)' : ''} : +${r.points} points.`}</p>
      <Scores scores={v.scores} pips={r.pips} />
      <button className="btn primary" data-club="next" onClick={() => club.nextRound()}>Manche suivante ▶</button>
    </div>
  );
}
function Scores({ scores, pips, ranking }: { scores: number[]; pips?: number[]; ranking?: number[] }) {
  const order = ranking ?? scores.map((_, i) => i);
  return <table className="dom-scores"><tbody>{order.map((i, k) => <tr key={i} className={i === 0 ? 'me' : ''}><td>{ranking ? `${k + 1}.` : ''}</td><td>{i === 0 ? '⭐ Toi' : `🤖 ${name(i)}`}</td><td>{scores[i]} pts</td>{pips && <td className="muted">{pips[i]} restants</td>}</tr>)}</tbody></table>;
}
function Results() {
  const ses = club.s.session!; const res = ses.host.result!; const last = ses.host.state.rounds[ses.host.state.rounds.length - 1];
  const won = res.winners.includes(0); const draw = res.endedBy === 'normal' && res.winners.length === 0;
  const head = res.endedBy !== 'normal' ? 'Partie abandonnée' : won ? (res.winners.length > 1 ? '🤝 Égalité en tête !' : '🏆 Tu gagnes !') : draw ? '🤝 Égalité : jeu bloqué' : `${name(res.winners[0])} gagne`;
  return (
    <div className="dom-modal results" data-club="results" data-won={won ? '1' : '0'}>
      <h3>{head}</h3>
      {last && <p className="muted">{last.reason === 'domino' ? `Domino ! ${last.winner === 0 ? 'Tu as' : name(last.winner!) + ' a'} posé son dernier domino.` : 'Personne ne pouvait plus jouer : le moins de points en main l’emporte.'}</p>}
      <Scores scores={res.scores} pips={last?.pips} ranking={res.ranking} />
      <p className="muted small">{LOCAL_BADGE}. Résultat gardé pour cette session seulement : pas d’Or, pas d’XP, pas de statistiques enregistrées.</p>
      <div className="row"><button className="btn primary" data-club="replay" onClick={() => club.replay()}>🔁 Rejouer</button><button className="btn" data-club="leave" onClick={() => club.leave()}>🚪 Quitter la table</button></div>
    </div>
  );
}
