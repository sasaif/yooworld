// Environment separation at runtime: the Worker refuses to serve with a mixed configuration.
import { it, expect, afterEach } from 'vitest';
import { startWrangler, stopWrangler, http, VARS } from './harness';
afterEach(async () => { await stopWrangler(); });
it('ENV_TAG=uat with a loopback database and placeholder secrets -> every route 500 env_invalid', async () => {
  await startWrangler({ ENV_TAG: 'uat' }, 500);
  const r = await http('GET', '/api/health');
  expect(r.json.code).toBe('env_invalid');
  expect(r.json.errors.join(' ')).toMatch(/loopback/);
  expect(r.json.errors.join(' ')).toMatch(/placeholder/);
  expect((await http('POST', '/api/auth/sign-in/email', { body: { email: 'a@b.c', password: 'x' } })).status).toBe(500);
});
it('reused secret (ticket = session secret) -> refused', async () => {
  await startWrangler({ TICKET_SECRET: VARS.BETTER_AUTH_SECRET }, 500);
  expect((await http('GET', '/api/health')).json.errors.join(' ')).toMatch(/must differ/);
});
