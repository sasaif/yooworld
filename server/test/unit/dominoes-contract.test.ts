// Contract test (QA B5 coupling): the server's authoritative Dominoes table runs the CLIENT's pure rules
// (src/minigames). Any change to those files must be a conscious, reviewed decision for the server too, so this
// test pins (1) the exact bytes of the client rule files and (2) the behaviour of 20 seeded full games.
// Drift -> this test (and the CI `server` job) fails. To accept a reviewed change: PIN_CONTRACT=1 npx vitest run test/unit/dominoes-contract.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newTable, joinTable, legalFor, moveTable, tableResult, type TableState } from '../../src/core/tableGame';

const ROOT = path.resolve(__dirname, '../../..');
const FILES = ['src/minigames/rng.ts', 'src/minigames/types.ts', 'src/minigames/turnEngine.ts', 'src/minigames/dominoes/rules.ts'];
const PIN = path.resolve(__dirname, '../contracts/dominoes-client-rules.json');
const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

function playAll() {
  const games: unknown[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    let t = joinTable(newTable(`g${seed}`, 'p0'), 'p1', seed) as TableState;
    const moves: unknown[] = [];
    for (let i = 0; i < 500 && typeof tableResult(t) === 'string'; i++) {
      const turn = t.players.find((p) => legalFor(t, p).length > 0);
      if (!turn) break;
      const m = legalFor(t, turn)[0]; moves.push([turn, m]);
      const r = moveTable(t, turn, m, t.engine!.seq); if (typeof r === 'string') throw new Error(`illegal: ${r}`); t = r;
    }
    games.push({ seed, moves: sha(JSON.stringify(moves)), result: tableResult(t) });
  }
  return games;
}

describe('client Dominoes rules contract', () => {
  it('rule files and seeded behaviour match the pinned contract', () => {
    const now = { files: Object.fromEntries(FILES.map((f) => [f, sha(fs.readFileSync(path.join(ROOT, f)))])), behaviour: sha(JSON.stringify(playAll())) };
    if (process.env.PIN_CONTRACT === '1') fs.writeFileSync(PIN, JSON.stringify({ ...now, pinned_at: new Date().toISOString() }, null, 2) + '\n');
    const pinned = JSON.parse(fs.readFileSync(PIN, 'utf8'));
    expect(now.files, 'client src/minigames rule files changed: review the server table (src/core/tableGame.ts), then re-pin').toEqual(pinned.files);
    expect(now.behaviour, 'Dominoes behaviour changed for pinned seeds: review the server impact, then re-pin').toBe(pinned.behaviour);
  });
  it('20 seeded games all finish with a winner', () => {
    for (const g of playAll() as { result: any }[]) { expect(typeof g.result).toBe('object'); expect(g.result.winners.length).toBeGreaterThan(0); }
  });
});
