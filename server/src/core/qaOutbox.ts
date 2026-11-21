/**
 * QA outbox (uat only, EMAIL_MODE=capture): verification / reset e-mails are not sent, they are kept server-side for
 * OUTBOX_TTL_MS (auto-purged) and readable by QA at GET /qa/outbox?to=<email> with the QA_OUTBOX_TOKEN secret.
 * The env schema refuses capture outside uat; the route answers 404 whenever capture is off.
 */
export const OUTBOX_TTL_MS = 15 * 60_000;
export const OUTBOX_MAX_ROWS = 200;
export interface OutboxMessage { to: string; kind: 'verify' | 'reset'; url: string; at: number }

export const normalizeRecipient = (s: string) => s.trim().toLowerCase();

/** Constant-time string comparison: both sides are hashed first (equal length), then compared without early exit. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

/** Access decision for /qa/outbox: 404 unless capture mode (with a token configured), 401 on a wrong/missing token. */
export async function outboxAccess(cfg: { env: string; emailMode: string; qaOutboxToken?: string }, presented: string | null | undefined): Promise<200 | 401 | 404> {
  if (cfg.env !== 'uat' || cfg.emailMode !== 'capture' || !cfg.qaOutboxToken) return 404;
  if (!presented) return 401;
  return (await safeEqual(presented, cfg.qaOutboxToken)) ? 200 : 401;
}
/** Token from `Authorization: Bearer <t>` or `x-qa-token: <t>` (never from the query string: it would end up in logs). */
export function presentedToken(authorization?: string | null, xQaToken?: string | null): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return m ? m[1].trim() : (xQaToken?.trim() || null);
}
