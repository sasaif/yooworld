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

/**
 * On-screen keyboard (iOS Safari keeps innerHeight and shrinks the visual viewport instead): when a text field has the
 * focus and the visual viewport is clearly shorter than the window, report how far the keyboard covers the bottom of the
 * stage (`off`) and the visible height (`vh`), so the chat card can sit right above the keyboard.
 */
export function keyboardInset(win: Pick<Window, 'innerHeight'> & { visualViewport?: { height: number; offsetTop?: number; scale?: number } | null }, typing: boolean, restH = 0): { open: boolean; off: number; vh: number; resized?: true } {
  const vv = win.visualViewport; if (!typing || !vv || Math.abs((vv.scale ?? 1) - 1) > 0.01) return { open: false, off: 0, vh: win.innerHeight };
  const off = Math.max(0, Math.round(win.innerHeight - (vv.offsetTop ?? 0) - vv.height));
  if (off > 80) return { open: true, off, vh: Math.round(vv.height) };
  // Android 'resizes-content': the keyboard shrinks the LAYOUT viewport (innerHeight drops, visualViewport.height ≈
  // innerHeight, so `off` ≈ 0). Detected against the height measured before the field got the focus (`restH`).
  if (restH - win.innerHeight > 80) return { open: true, off: 0, vh: Math.round(Math.min(vv.height, win.innerHeight)), resized: true };
  return { open: false, off: 0, vh: win.innerHeight };
}
/** Layout height while no field has the focus (per width = per orientation), for the resizes-content check above.
 *  Touch devices only (a desktop window resized while typing is not a keyboard). iOS never shrinks innerHeight for the
 *  keyboard, so its path is unchanged. */
let rest = { w: 0, h: 0 };
const coarse = () => { try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; } };
export function keyboardInsetNow(typing: boolean) {
  if (!typing || rest.w !== window.innerWidth) rest = { w: window.innerWidth, h: window.innerHeight };
  return keyboardInset(window, typing, coarse() ? rest.h : 0);
}

/** Chat card layout while the keyboard is up, from the visible height (px): 'normal' = header + recent messages + input,
 *  'tight' (< 125 px) = recent message line + input (header hidden until the keyboard closes), 'min' (< 90 px) = input only. */
export function keyboardLayout(open: boolean, vh: number): 'none' | 'normal' | 'tight' | 'min' { return !open ? 'none' : vh < 90 ? 'min' : vh < 125 ? 'tight' : 'normal'; }
const typingNow = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable); };

export function installViewportFill() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const root = document.documentElement; let raf = 0; const timers: ReturnType<typeof setTimeout>[] = [];
  const apply = () => {
    raf = 0; const { w, h } = appViewport(window);
    const kb = keyboardInsetNow(typingNow());
    root.classList.toggle('kb-open', kb.open); const lay = keyboardLayout(kb.open, kb.vh); root.classList.toggle('kb-tight', lay === 'tight' || lay === 'min'); root.classList.toggle('kb-min', lay === 'min'); root.style.setProperty('--kb-off', kb.off + 'px'); root.style.setProperty('--vv-h', kb.vh + 'px');
    // while the keyboard is up, the stage keeps its full height (the card moves above the keyboard instead) and Safari's
    // own scroll to the focused field is left alone
    root.style.setProperty('--app-h', (kb.open ? window.innerHeight : h) + 'px'); root.style.setProperty('--app-w', w + 'px');
    if (!kb.open && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  };
  const on = () => { if (!raf) raf = requestAnimationFrame(apply); };
  const late = () => { on(); for (const ms of [120, 350, 700, 1200]) timers.push(setTimeout(on, ms)); };
  const noZoom = (e: Event) => e.preventDefault(); // Safari-only 'gesture*' events = page pinch-zoom
  apply();
  addEventListener('resize', on); addEventListener('orientationchange', late); addEventListener('pageshow', late);
  window.visualViewport?.addEventListener('resize', on); window.visualViewport?.addEventListener('scroll', on);
  screen.orientation?.addEventListener?.('change', late);
  document.addEventListener('focusin', late); document.addEventListener('focusout', late);
  document.addEventListener('gesturestart', noZoom, { passive: false }); document.addEventListener('gesturechange', noZoom, { passive: false });
  return () => {
    removeEventListener('resize', on); removeEventListener('orientationchange', late); removeEventListener('pageshow', late);
    window.visualViewport?.removeEventListener('resize', on); window.visualViewport?.removeEventListener('scroll', on);
    screen.orientation?.removeEventListener?.('change', late);
    document.removeEventListener('focusin', late); document.removeEventListener('focusout', late);
    document.removeEventListener('gesturestart', noZoom); document.removeEventListener('gesturechange', noZoom);
    timers.forEach(clearTimeout); if (raf) cancelAnimationFrame(raf);
  };
}
