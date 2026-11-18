import { useStore } from '../../core/store';
import { economy, fashion } from '../../app/services';
import { errText } from '../../fashion/FashionController';
import { fmt } from '../../economy/money';
import { REWARDS, dailyReadyIn } from '../../economy/rewards';
import { DIAMOND_PACKS, UnavailablePaymentGateway } from '../../economy/payments/DiamondStore';
import type { LedgerEntry } from '../../economy/ledger';
const KIND: Record<string, string> = { test_grant: 'Solde de test', reward: 'Récompense', purchase: 'Achat boutique', furniture: 'Meuble / déco', trade_escrow: 'Échange (séquestre)', trade_release: 'Échange annulé (remboursé)', trade_receive: 'Échange reçu', refund: 'Remboursement', dev_grant: 'DEV — aucun paiement réel', iap_grant: 'Achat de diamants' };
const gateway = new UnavailablePaymentGateway();
function Ledger({ entries, icon }: { entries: LedgerEntry[]; icon: string }) {
  return <ul className="ledger">{entries.slice(-12).reverse().map((e) => <li key={e.txId + e.kind}><span className={e.delta > 0 ? 'plus' : 'minus'}>{e.delta > 0 ? '+' : '−'}{fmt(Math.abs(e.delta))} {icon}</span><span className="lg-k">{KIND[e.kind] ?? e.kind}{e.memo && e.memo !== KIND[e.kind] ? ` · ${e.memo}` : ''}</span><small>{new Date(e.at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · solde {fmt(e.balanceAfter)}</small></li>)}</ul>;
}
export function WalletPanel() {
  useStore(fashion.store, (s) => s.ecoRev); const a = economy.snapshot().account; const wait = dailyReadyIn(economy.debugState!(), a.id, Date.now());
  return <div className="wallet">
    <div className="wl-cards">
      <div className="wl-card gold"><div className="wl-h">🪙 Or <span className="test-tag">TEST</span></div><div className="wl-v">{fmt(a.gold.balance)}</div><small>Monnaie du jeu : gagnée en jouant (récompense du jour, danse, détente, visite de Yoo Plage), dépensée en boutique et en déco, échangeable entre joueurs.</small>
        <button className="btn buy" disabled={wait > 0} onClick={() => void fashion.daily()}>{wait > 0 ? `Récompense du jour dans ${Math.ceil(wait / 3600000)} h` : `🎁 Récompense du jour +${REWARDS.daily.gold} 🪙`}</button>
        <small className="muted">Danse : +{REWARDS.dance.gold} 🪙 / {REWARDS.dance.periodS} s (max {REWARDS.dance.capPerDay}/jour) · Assis : +{REWARDS.sit.gold} 🪙 / {REWARDS.sit.periodS} s (max {REWARDS.sit.capPerDay}/jour) · Plage : +{REWARDS.visit_beach.gold} 🪙 / jour</small></div>
      <div className="wl-card diamond"><div className="wl-h">💎 Diamants <span className="test-tag">TEST</span></div><div className="wl-v">{fmt(a.diamond.balance)}</div><small>Monnaie premium, obtenue uniquement par achat réel (bientôt). Non transférable, non échangeable, non offrable. Aucune conversion Or ↔ Diamants.</small>
        <div className="packs">{DIAMOND_PACKS.map((p) => <button key={p.id} className="pack" disabled title="Paiement non activé">💎 {p.diamonds}{p.bonus ? <small> +{p.bonus}</small> : null}<em>Bientôt</em></button>)}</div>
        <small className="muted">Paiement sécurisé validé par serveur — non connecté (fournisseur : {gateway.name}). Aucun paiement n’est possible pour l’instant.</small>
        {economy.mode === 'local-dev' && <div className="dev"><b>DEV</b> — aucun paiement réel<button className="btn sm" onClick={() => void economy.devGrantDiamonds(50).then(() => fashion.notify('+50 💎 (DEV, gratuit)'), (e) => fashion.notify(errText(e), 'err'))}>+50 💎 de test</button>
          <button className="btn ghost sm" onClick={() => { if (confirm('Remettre l’économie de test à zéro (5 000 Or / 100 Diamants, articles achetés supprimés) ?')) { economy.resetDev(); location.reload(); } }}>Réinitialiser l’économie de test</button></div>}</div>
    </div>
    <div className="wl-ledgers"><div><h4>Historique Or</h4><Ledger entries={a.gold.entries} icon="🪙" /></div><div><h4>Historique Diamants</h4><Ledger entries={a.diamond.entries} icon="💎" /></div></div>
    <p className="muted small">Prototype local : les soldes sont stockés sur cet appareil et servent uniquement aux tests. En production, soldes, achats et échanges seront validés par le serveur.</p>
  </div>;
}
