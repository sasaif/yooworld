/**
 * Human check (anti-bot) hook. Interface + Cloudflare Turnstile implementation + a fake for local tests.
 * Phase B: NO real keys anywhere; local runs use mode 'off' (default) or 'fake'. prod must use 'turnstile' (uat may use 'fake' until a Turnstile widget exists: the fake token is public, so uat sign-up is NOT bot-protected)
 * with a real secret (enforced by envSchema). Fail closed: any network/parse error = not verified.
 */
export interface HumanVerdict { ok: boolean; codes: string[] }
export interface HumanVerifier { readonly mode: HumanMode; verify(token: string | null | undefined, ip?: string | null): Promise<HumanVerdict> }
export type HumanMode = 'off' | 'fake' | 'turnstile';
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Token accepted by the fake verifier (local tests only). */
export const FAKE_PASS_TOKEN = 'local-fake-pass';

export class TurnstileVerifier implements HumanVerifier {
  readonly mode = 'turnstile' as const;
  constructor(private secret: string, private fetchFn: typeof fetch = fetch, private timeoutMs = 3000) {}
  async verify(token: string | null | undefined, ip?: string | null): Promise<HumanVerdict> {
    if (!token || token.length > 2048) return { ok: false, codes: ['missing-input-response'] };
    const form = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) form.set('remoteip', ip);
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.timeoutMs);
      const r = await this.fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) return { ok: false, codes: [`http-${r.status}`] };
      const j = (await r.json()) as { success?: boolean; 'error-codes'?: string[] };
      return { ok: j.success === true, codes: j['error-codes'] ?? [] };
    } catch { return { ok: false, codes: ['verify-unavailable'] }; }
  }
}
export class FakeVerifier implements HumanVerifier {
  readonly mode = 'fake' as const;
  readonly calls: { token: string | null | undefined; ip?: string | null }[] = [];
  async verify(token: string | null | undefined, ip?: string | null): Promise<HumanVerdict> {
    this.calls.push({ token, ip });
    return token === FAKE_PASS_TOKEN ? { ok: true, codes: [] } : { ok: false, codes: ['invalid-input-response'] };
  }
}
export class OffVerifier implements HumanVerifier {
  readonly mode = 'off' as const;
  async verify(): Promise<HumanVerdict> { return { ok: true, codes: ['disabled'] }; }
}
export function makeVerifier(mode: HumanMode, secret?: string, fetchFn?: typeof fetch): HumanVerifier {
  if (mode === 'turnstile') { if (!secret) throw new Error('TURNSTILE_SECRET missing'); return new TurnstileVerifier(secret, fetchFn); }
  return mode === 'fake' ? new FakeVerifier() : new OffVerifier();
}
/** Routes protected by the human check (bot-attractive, unauthenticated). */
export const HUMAN_CHECKED = ['/api/auth/sign-up/email', '/api/auth/request-password-reset'] as const;
