/**
 * Full-screen guard for mobile browsers (iPhone Safari in landscape especially).
 * Real-device bug (user screenshots, Nov 2026): after zooming / switching to 'Vue perso' a ~15 % empty mauve band
 * appeared under the game: the stage was sized with 100dvh, which WebKit does not always refresh after a rotation or
 * when the toolbars collapse / expand, and a stray page pinch-zoom or scroll can shift the fixed layer.
 * Fix: size the stage from the live window height (--app-h / --app-w), re-measured on resize, rotation (several times,
 * iOS reports the final size late), visualViewport resize/scroll and page show; keep the page scrolled to 0,0 and
 * block Safari's page pinch-zoom gestures (the game's own pinch zoom is handled by the canvas controls).
 */
export function appViewport(win: Pick<Window, 'innerWidth' | 'innerHeight'> & { visualViewport?: { width: number; height: number; scale?: number } | null }) {
  const vv = win.visualViewport; const scale = vv?.scale ?? 1;
  // innerHeight follows the toolbars; when the page is pinch-zoomed (scale > 1) the visual viewport is smaller than the
  // layout one, so never size the stage from a zoomed visual viewport.
  const h = vv && Math.abs(scale - 1) < 0.01 ? Math.max(vv.height, win.innerHeight) : win.innerHeight;
  const w = vv && Math.abs(scale - 1) < 0.01 ? Math.max(vv.width, win.innerWidth) : win.innerWidth;
  return { w: Math.round(w), h: Math.round(h) };
}

export function installViewportFill() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const root = document.documentElement; let raf = 0; const timers: ReturnType<typeof setTimeout>[] = [];
  const apply = () => {
    raf = 0; const { w, h } = appViewport(window);
    root.style.setProperty('--app-h', h + 'px'); root.style.setProperty('--app-w', w + 'px');
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
  const late = () => { on(); for (const ms of [120, 350, 700, 1200]) timers.push(setTimeout(on, ms)); };
  const noZoom = (e: Event) => e.preventDefault(); // Safari-only 'gesture*' events = page pinch-zoom
  apply();
  addEventListener('resize', on); addEventListener('orientationchange', late); addEventListener('pageshow', late);
  window.visualViewport?.addEventListener('resize', on); window.visualViewport?.addEventListener('scroll', on);
  screen.orientation?.addEventListener?.('change', late);
  document.addEventListener('gesturestart', noZoom, { passive: false }); document.addEventListener('gesturechange', noZoom, { passive: false });
  return () => {
    removeEventListener('resize', on); removeEventListener('orientationchange', late); removeEventListener('pageshow', late);
    window.visualViewport?.removeEventListener('resize', on); window.visualViewport?.removeEventListener('scroll', on);
    screen.orientation?.removeEventListener?.('change', late);
    document.removeEventListener('gesturestart', noZoom); document.removeEventListener('gesturechange', noZoom);
    timers.forEach(clearTimeout); if (raf) cancelAnimationFrame(raf);
  };
}
