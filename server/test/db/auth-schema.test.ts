import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { getMigrations } from 'better-auth/db/migration';
import { rolePool } from '../helpers/db';

describe('0002_auth matches Better Auth', () => {
  it('Better Auth (as app_auth) finds nothing to create or alter', async () => {
    const pool = rolePool('app_auth', 2);
    try {
      const auth = betterAuth({ database: pool as unknown as pg.Pool, secret: 'x'.repeat(32), baseURL: 'http://localhost:8787',
        emailAndPassword: { enabled: true }, rateLimit: { enabled: true, storage: 'database' },
        advanced: { database: { generateId: 'uuid' } }, plugins: [twoFactor()] });
      const { toBeCreated, toBeAdded } = await getMigrations(auth.options);
      expect(toBeCreated.map((t) => t.table)).toEqual([]);
      expect(toBeAdded.map((t) => t.table)).toEqual([]);
    } finally { await pool.end(); }
  });
});
