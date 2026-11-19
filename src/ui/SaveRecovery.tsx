import { useState } from 'react';
import { useStore } from '../core/store';
import { backups, economy, game } from '../app/services';
import type { SaveProblem } from '../persistence/LocalStorageRepository';
import { restorableSnapshot } from '../persistence/backup';
import { storage } from '../persistence/storage';

/** P0.B recovery panel. Shown when a save record exists but cannot be read safely (corrupt JSON, newer schema,
 *  unexpected shape). Nothing has been written or erased at that point; the raw bytes are already copied to
 *  backup:raw:<key>. There is no automatic reset: every action below is an explicit player choice. */
const KIND: Record<SaveProblem['kind'], string> = { corrupt: 'illisible', future_schema: 'créée par une version plus récente', invalid: 'dans un format inattendu' };
const fmt = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export function SaveRecovery({ onStarted }: { onStarted: () => void }) {
  const gameProblems = useStore(game.store, (s) => s.saveProblems); const temporary = useStore(game.store, (s) => s.temporary);
  const [ecoDismissed, setEcoDismissed] = useState(false);
  const problems = [...gameProblems, ...(economy.problem && !ecoDismissed ? [economy.problem] : [])];
  if (!problems.length) return temporary || (economy.problem && economy.readOnly) ? <div className="save-temp">Session temporaire : rien n’est enregistré</div> : null;
  const keys = problems.map((p) => p.key); const snap = restorableSnapshot(backups.snapshots(), keys);
  const restore = () => { if (!snap || !confirm(`Restaurer la sauvegarde du ${fmt(snap.at)} ? La version actuelle reste copiée dans les sauvegardes.`)) return; backups.restore(snap, keys); location.reload(); };
  const temp = async () => { economy.enterTemporary(); setEcoDismissed(true); if (gameProblems.length) { await game.startTemporary(); onStarted(); } };
  const download = () => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([backups.exportAll()], { type: 'application/json' }));
    a.download = `yooworld-sauvegarde-${backups.env.replace(/\W+/g, '-')}-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const fresh = () => {
    if (!confirm('Recommencer avec des données de TEST neuves ?\nLa sauvegarde illisible reste copiée (Télécharger) et n’est pas effacée des sauvegardes.')) return;
    backups.snapshot('before start-fresh');
    for (const p of gameProblems) storage.data.removeItem(p.key); // its bytes stay in backup:raw:<key>
    if (economy.problem) economy.resetDev();
    location.reload();
  };
  return (
    <div className="save-recovery" role="dialog" aria-modal="true" data-testid="save-recovery">
      <div className="save-recovery-card">
        <h2>Sauvegarde à vérifier</h2>
        <p>Une partie de ta sauvegarde n’a pas pu être lue. <b>Rien n’a été effacé</b> : tes objets et tes soldes sont conservés tels quels, et une copie a été mise de côté.</p>
        <ul>{problems.map((p) => <li key={p.key}><code>{p.key}</code> : {KIND[p.kind]}</li>)}</ul>
        <div className="save-recovery-actions">
          <button className="btn" disabled={!snap} onClick={restore}>{snap ? `Restaurer la sauvegarde du ${fmt(snap.at)}` : 'Aucune sauvegarde valide à restaurer'}</button>
          <button className="btn" onClick={temp}>Continuer en session temporaire (rien n’est enregistré)</button>
          <button className="btn ghost" onClick={download}>Télécharger la sauvegarde brute</button>
          <button className="btn ghost danger" onClick={fresh}>Recommencer avec des données de test neuves…</button>
        </div>
        <p className="save-recovery-env">Environnement : {backups.env} · build {backups.buildId}</p>
      </div>
    </div>
  );
}
