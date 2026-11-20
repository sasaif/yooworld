// U7: HS256 verification-link pre-check (signature + expiry) and the already-verified redirect target.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyHs256, alreadyVerifiedRedirect } from '../../src/core/verifyLink';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload: unknown, secret: string, alg = 'HS256') => {
  const h = b64({ alg, typ: 'JWT' }), p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const S = 'k'.repeat(48); const now = Math.floor(Date.now() / 1000);

describe('verifyHs256', () => {
  it('accepts a valid token and lowercases the email', async () => {
    expect(await verifyHs256(sign({ email: 'A@B.C', userId: 'u1', exp: now + 60 }, S), S)).toMatchObject({ email: 'a@b.c', userId: 'u1' });
  });
  it('refuses wrong secret, expired, alg != HS256, malformed, missing email, payload swap', async () => {
    expect(await verifyHs256(sign({ email: 'a@b.c', exp: now + 60 }, 'other'.repeat(10)), S)).toBeNull();
    expect(await verifyHs256(sign({ email: 'a@b.c', exp: now - 1 }, S), S)).toBeNull();
    expect(await verifyHs256(sign({ email: 'a@b.c', exp: now + 60 }, S, 'none'), S)).toBeNull();
    expect(await verifyHs256('not.a.jwt!', S)).toBeNull();
    expect(await verifyHs256('abc', S)).toBeNull();
    expect(await verifyHs256(sign({ exp: now + 60 }, S), S)).toBeNull();
    const t = sign({ email: 'a@b.c', exp: now + 60 }, S); const [h, , sig] = t.split('.');
    expect(await verifyHs256(`${h}.${b64({ email: 'victim@b.c', exp: now + 60 })}.${sig}`, S)).toBeNull();
  });
});
describe('alreadyVerifiedRedirect', () => {
  const O = ['https://app.example', 'https://api.example'];
  it('keeps same-site paths and our own origins, adds the marker', () => {
    expect(alreadyVerifiedRedirect(undefined, O)).toBe('/?status=already_verified');
    expect(alreadyVerifiedRedirect('/', O)).toBe('/?status=already_verified');
    expect(alreadyVerifiedRedirect('/welcome?x=1', O)).toBe('/welcome?x=1&status=already_verified');
    expect(alreadyVerifiedRedirect('https://app.example/ok', O)).toBe('https://app.example/ok?status=already_verified');
  });
  it('never redirects off-site (open redirect)', () => {
    expect(alreadyVerifiedRedirect('https://evil.example/', O)).toBe('/?status=already_verified');
    expect(alreadyVerifiedRedirect('//evil.example/', O)).toBe('/?status=already_verified');
    expect(alreadyVerifiedRedirect('/\\evil.example', O)).toBe('/?status=already_verified');
    expect(alreadyVerifiedRedirect('javascript:alert(1)', O)).toBe('/?status=already_verified');
  });
});
