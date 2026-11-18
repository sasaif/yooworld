import { useEffect, useState } from 'react';
import { enterLandscape, needsRotate, readViewport, isPhone } from '../app/screen';

/** Keeps the viewport info fresh on resize / rotation / mobile toolbar changes. */
export function useViewport() {
  const [v, setV] = useState(readViewport);
  useEffect(() => {
    const on = () => setV(readViewport());
    const late = () => { on(); setTimeout(on, 250); }; // iOS reports the new size slightly after orientationchange
    addEventListener('resize', on); addEventListener('orientationchange', late); window.visualViewport?.addEventListener('resize', on);
    return () => { removeEventListener('resize', on); removeEventListener('orientationchange', late); window.visualViewport?.removeEventListener('resize', on); };
  }, []);
  return v;
}

/** Phones held in portrait get a clean "rotate" screen. Tablets / desktop are never affected. */
export function RotateOverlay() {
  const v = useViewport(); const [skip, setSkip] = useState(() => sessionStorage.getItem('yw.portrait') === '1');
  // First touch on a phone: try fullscreen + landscape lock (Android). Silently ignored where unsupported (iOS).
  useEffect(() => {
    if (!isPhone(readViewport())) return;
    const once = () => { void enterLandscape(); removeEventListener('pointerup', once); };
    addEventListener('pointerup', once); return () => removeEventListener('pointerup', once);
  }, []);
  if (!needsRotate(v) || skip) return null;
  const canFullscreen = !!document.fullscreenEnabled; // false on iPhone Safari
  return (
    <div className="rotate" role="dialog" aria-label="Tourne ton appareil">
      <div className="rotate-phone"><i /></div>
      <h2>Tourne ton appareil</h2>
      <p>YooWorld se joue en mode paysage.</p>
      {canFullscreen
        ? <button className="btn primary" onClick={() => void enterLandscape()}>Plein écran paysage</button>
        : <p className="rotate-tip">Astuce iPhone : <b>Partager → Sur l’écran d’accueil</b> pour jouer en plein écran.</p>}
      <button className="rotate-skip" onClick={() => { sessionStorage.setItem('yw.portrait', '1'); setSkip(true); }}>Continuer en portrait</button>
    </div>
  );
}
