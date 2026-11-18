/** Screen / orientation helpers for the mobile full-screen landscape experience. Pure parts are unit-tested. */
export interface ViewportInfo { w: number; h: number; coarse: boolean }

/** A phone = touch-first device whose short side is < 600 CSS px (tablets and desktops are never "phones"). */
export const isPhone = (v: ViewportInfo) => v.coarse && Math.min(v.w, v.h) < 600;
/** Show the "Tourne ton appareil" screen: phone held in portrait. */
export const needsRotate = (v: ViewportInfo) => isPhone(v) && v.h > v.w;

export function readViewport(): ViewportInfo {
  const vv = window.visualViewport;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return { w: Math.round(vv?.width ?? innerWidth), h: Math.round(vv?.height ?? innerHeight), coarse };
}

type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void> };
/**
 * Best effort "native game" mode: fullscreen + landscape lock. Must be called from a user gesture.
 * Android Chrome / Samsung Internet: works. iOS Safari: neither API exists for pages -> resolves false
 * (the rotate screen + "Ajouter à l'écran d'accueil" PWA manifest cover that case).
 */
export async function enterLandscape(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    }
  } catch { /* not allowed / not supported */ }
  try { await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape'); return true; } catch { return false; }
}
export const isStandalone = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
