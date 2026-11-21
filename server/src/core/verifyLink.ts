/**
 * Verification-link reuse (QA U7). Better Auth verification tokens are stateless HS256 JWTs (1 h): on reuse by an
 * already-verified user it silently redirects to callbackURL exactly like a first use. The Worker pre-checks the link:
 * only a token with a VALID signature (BETTER_AUTH_SECRET) and not expired is considered, so the check cannot be used
 * to probe arbitrary addresses; if that user is already verified the answer is a plain redirect marked
 * `status=already_verified`, with no session and no cookie. Anything else goes to Better Auth unchanged.
 */
const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));

export interface VerifyClaims { email: string; userId?: string; updateTo?: string; exp: number }
/** HS256 JWT verification (signature + exp). Returns the claims, or null for anything invalid. */
export async function verifyHs256(token: string, secret: string, nowS = Math.floor(Date.now() / 1000)): Promise<VerifyClaims | null> {
  const parts = token.split('.'); if (parts.length !== 3 || token.length > 4096) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])));
    if (header.alg !== 'HS256') return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
    if (typeof p.email !== 'string' || typeof p.exp !== 'number' || p.exp <= nowS) return null;
    return { email: p.email.toLowerCase(), userId: typeof p.userId === 'string' ? p.userId : undefined, updateTo: typeof p.updateTo === 'string' ? p.updateTo : undefined, exp: p.exp };
  } catch { return null; }
}
/** Redirect target for an already-verified link: a same-site path or one of our own origins, else '/'. */
export function alreadyVerifiedRedirect(callbackURL: string | undefined, allowedOrigins: string[]): string {
  let target = '/';
  if (callbackURL && callbackURL.startsWith('/') && !callbackURL.startsWith('//') && !callbackURL.startsWith('/\\')) target = callbackURL;
  else if (callbackURL) { try { const u = new URL(callbackURL); if (allowedOrigins.includes(u.origin)) target = u.toString(); } catch { /* keep '/' */ } }
  return target + (target.includes('?') ? '&' : '?') + 'status=already_verified';
}
