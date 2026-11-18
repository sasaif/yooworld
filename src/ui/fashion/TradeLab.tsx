import { useState } from 'react';
import { useStore } from '../../core/store';
import { economy, fashion } from '../../app/services';
import { errText } from '../../fashion/FashionController';
import { TEST_FRIEND, TEST_PLAYER } from '../../economy/bank';
import { newTxId } from '../../economy/EconomyService';
import { fmt } from '../../economy/money';
import type { Trade, TradeSide } from '../../economy/trading';
/** LOCAL TEST harness for Gold trading: two dev accounts on THIS device. It is not multiplayer and says so.
 *  Every action runs through EconomyService exactly like a future server-backed trade would. */
const STATUS: Record<Trade['status'], string> = { open: 'Ouverte — offres modifiables', locked: 'Verrouillée — or sous séquestre', completed: 'Exécutée ✓', rejected: 'Refusée', cancelled: 'Annulée' };
async function as<T>(acc: string, fn: () => Promise<T>) { const prev = economy.currentAccount(); economy.switchAccount(acc); try { return await fn(); } finally { economy.switchAccount(prev); } }
function Side({ t, side, label }: { t: Trade; side: TradeSide; label: string }) {
  const acc = economy.snapshot().accounts.find((a) => a.id === side.account)!; const [v, setV] = useState(String(side.offer.gold || ''));
  const run = (fn: () => Promise<unknown>, ok?: string) => as(side.account, fn).then(() => ok && fashion.notify(ok), (e) => fashion.notify(errText(e), 'err'));
  return <div className={'tr-side' + (side.account === TEST_PLAYER ? ' me' : '')}>
    <div className="tr-who"><b>{label}</b><small>{acc.label}</small></div>
    <div className="tr-bal">🪙 {fmt(acc.gold.balance)} <span className="tr-lock" title="Les diamants ne sont jamais échangeables">💎 {fmt(acc.diamond.balance)} 🔒 non échangeable</span></div>
    <div className="tr-offer"><span>Offre :</span>{t.status === 'open' ? <><input inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" aria-label={`Or offert par ${label}`} /><span>🪙</span>
      <button className="btn sm" onClick={() => void run(() => economy.setOffer(t.id, { gold: Number(v || 0) }), 'Offre mise à jour')}>Proposer</button></> : <b>🪙 {fmt(side.offer.gold)}</b>}</div>
    <div className="tr-flags"><span className={side.accepted ? 'ok' : ''}>{side.accepted ? '✓ a accepté' : '… n’a pas accepté'}</span>{t.status !== 'open' && <span className={side.confirmed ? 'ok' : ''}>{side.confirmed ? '✓ a confirmé' : '… confirmation'}</span>}</div>
    <div className="row wrap">
      {t.status === 'open' && <button className="btn" disabled={side.accepted} onClick={() => void run(() => economy.acceptTrade(t.id))}>Accepter l’offre</button>}
      {t.status === 'locked' && <button className="btn buy" disabled={side.confirmed} onClick={() => void run(() => economy.confirmTrade(t.id))}>Confirmer</button>}
      {(t.status === 'open' || t.status === 'locked') && <button className="btn ghost" onClick={() => void run(() => economy.rejectTrade(t.id))}>Refuser</button>}
    </div>
  </div>;
}
export function TradeLab() {
  useStore(fashion.store, (s) => s.ecoRev); const snap = economy.snapshot(); const active = snap.trades.find((t) => t.status === 'open' || t.status === 'locked'); const past = snap.trades.filter((t) => t !== active).slice(0, 6);
  return <div className="trade">
    <div className="tr-banner">🧪 <b>Mode test local</b> : deux comptes de test sur cet appareil. Il n’y a pas encore de multijoueur : aucun joueur en ligne, aucun échange en ligne. Seul l’<b>Or</b> est échangeable ; les <b>Diamants</b> ne le sont jamais.</div>
    <ol className="tr-steps"><li className={active ? 'done' : 'cur'}>Demande</li><li className={active?.status === 'open' ? 'cur' : active ? 'done' : ''}>Offres + acceptation des deux</li><li className={active?.status === 'locked' ? 'cur' : ''}>Séquestre + double confirmation</li><li>Exécution</li></ol>
    {!active ? <button className="btn buy big" onClick={() => void economy.openTrade(TEST_FRIEND, newTxId('trade').replace(/:/g, '-')).then(() => fashion.notify('Demande d’échange ouverte'), (e) => fashion.notify(errText(e), 'err'))}>🤝 Ouvrir une demande d’échange avec le compte test B</button>
      : <div className="tr-live"><div className="tr-status">Échange <code>{active.id.slice(-6)}</code> · {STATUS[active.status]}</div>
        <div className="tr-sides"><Side key={active.a.account + active.updatedAt} t={active} side={active.a} label="Compte A" /><Side key={active.b.account + active.updatedAt} t={active} side={active.b} label="Compte B" /></div>
        <p className="muted small">Toute modification d’offre annule les acceptations. À l’acceptation des deux, l’or offert est retiré des soldes et placé sous séquestre (impossible de le dépenser ailleurs) jusqu’à la confirmation ou l’annulation.</p></div>}
    {past.length > 0 && <><h4>Historique des échanges</h4><ul className="tr-hist">{past.map((t) => <li key={t.id}><b>{STATUS[t.status]}</b> · A → B 🪙 {fmt(t.a.offer.gold)} · B → A 🪙 {fmt(t.b.offer.gold)} <small>{new Date(t.updatedAt).toLocaleTimeString('fr-FR')}</small>
      <details><summary>Journal</summary>{t.log.map((l, i) => <div key={i} className="small">{new Date(l.at).toLocaleTimeString('fr-FR')} — {l.who === TEST_PLAYER ? 'A' : l.who === TEST_FRIEND ? 'B' : l.who} : {l.what}</div>)}</details></li>)}</ul></>}
  </div>;
}
