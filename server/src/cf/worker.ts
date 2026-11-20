/**
 * API Worker entry (LOCAL dev only in Phase B). Milestone 1 exposes health + config readout only;
 * routes for auth, saves, directory, tickets and the EconomyGate land in later milestones.
 */
import { Hono } from 'hono';

export interface Env { ENV_TAG: 'local' | 'uat' | 'prod' }
const app = new Hono<{ Bindings: Env }>();
app.get('/api/health', (c) => c.json({ ok: true, env: c.env.ENV_TAG, service: 'yoland-api', milestone: 1 }));
export default app;
