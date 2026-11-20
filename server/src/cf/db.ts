/** Postgres access from the Worker: one short-lived client per request (Workers must not share TCP pools across
 *  requests). DB outages are detected and turned into 503 + Retry-After by the caller. */
import pg from 'pg';

export const DB_TIMEOUT_MS = 2500;
export function client(url: string) {
  return new pg.Client({ connectionString: url, connectionTimeoutMillis: DB_TIMEOUT_MS, query_timeout: 5000, statement_timeout: 5000 });
}
const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006']);
export function isDbDown(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err?.code && DOWN_CODES.has(err.code)) return true;
  return /timeout|terminated|connect|ECONNREFUSED|socket/i.test(String(err?.message ?? ''));
}
export class DbDown extends Error { constructor(cause: unknown) { super('database unavailable'); this.cause = cause; } }

/** Run fn with a connected client; always closes it. Connection-level failures become DbDown. */
export async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = client(url);
  try { await c.connect(); } catch (e) { try { await c.end(); } catch { /* */ } throw new DbDown(e); }
  try { return await fn(c); }
  catch (e) { if (isDbDown(e)) throw new DbDown(e); throw e; }
  finally { c.end().catch(() => {}); }
}
