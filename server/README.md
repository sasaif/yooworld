# YoLand backend — `server/` (Phase B, LOCAL ONLY)

Backend foundation for YoLand: one API Worker (Hono) + Durable Objects for rooms, room directory and game tables +
Postgres as the single source of truth, with every economy write going through the **EconomyGate**
(SECURITY DEFINER functions in schema `eco`). Nothing here is deployed; no cloud account is used.

## Layout
| Path | What |
|---|---|
| `db/migrations/0001_roles.sql` | DB roles (no passwords in repo). `app_api` = EXECUTE on a whitelist only. |
| `db/migrations/0002_auth.sql` | Better Auth schema (owned by `app_auth`), uuid ids. |
| `db/migrations/0003_eco.sql` | Ledger, wallets, items, gifts, rewards, activities, trades, reconciliation, grants. |
| `db/migrations/0004_social.sql` | Player-created events (foundation). |
| `db/migrations/0005_prog.sql` | Progression hooks; Prestige-cannot-be-bought trigger. |
| `db/migrations/0006_mod_audit.sql` | Moderation, blocks, hash-chained audit log, admin approvals, `app.saves`. |
| `db/migrations/0007_rooms_saves.sql` | Room caps as config (pending approval), server saves (`app.save_put/load`), `eco.item_set_state` (equip/place), farm activity, local-only `auth.dev_mail`. |
| `db/migrations/0008_games_admin.sql` | `eco.env_check`, `eco.activity_room`, `prog.match_results` + `prog.record_match`, `audit.admins`, `audit.admin_request/approve` (2FA + second admin). |
| `db/migrations/0009_owner_rules_purchase_hooks.sql` | Owner rule: Diamond hold = 0; `eco.purchase_events` (account age at purchase) + `eco.account_age_days()`. |
| `src/core/roomcore.ts` | Portable room logic (movement budget, chat, caps, tickets, kick ban, rate limits, interest management). |
| `src/core/directory.ts` / `ticket.ts` / `rooms.ts` | Shard placement (friend, then fill-first) / HMAC single-use 30 s tickets / room catalogue. |
| `src/core/tableGame.ts` | Server-authoritative Dominoes using the client's own pure rules (`src/minigames`). |
| `src/core/envSchema.ts` | Env validation: refuses mixed environments (loopback vs remote DB, TLS, roles, secrets). |
| `src/cf/room-do.ts`, `directory-do.ts`, `table-do.ts` | Durable Object adapters (hibernatable WebSockets, SQLite). |
| `src/core/economy.ts` | `EconomyGate` interface + Postgres implementation (1 SQL call per operation). |
| `src/core/productRules.ts` | Product rules and their approval status (source of truth: `eco.config`). |
| `src/cf/worker.ts` | API Worker: auth, saves, items, rooms/tickets, WebSocket upgrade, events, economy, tables, admin. |
| `.dev.vars.example` | Local variables template (copy to `.dev.vars`, git-ignored). No real secret anywhere in git. |
| `test/e2e/` | End-to-end tests against `wrangler dev --local` + local Postgres (`npm run test:e2e`). |
| `../shared/` | Types shared with the client (protocol, economy). |
| `scripts/pg-local.mjs` | Private local Postgres 18 (embedded binaries), `server/.local/pgdata`, port 54339. |
| `scripts/migrate.mjs` | Migration runner (checksums, env tag, refuses prod and non-loopback hosts). |

## Commands (exact — verified on a fresh clone of 9dedf8e)
Prerequisites: **Node >= 22.12 + npm** (`engines` in package.json; wrangler 4.x refuses older Node, so `npm run test:e2e`
fails on Node 20 — QA B1). On this box: Node 22 (the system `/usr/bin/node` is v20 *without* npm, so use the bundled
Node 22). No account, no network service other than `npm ci`. Postgres comes from the npm package `embedded-postgres`.
```bash
export PATH=/workspace/games-3d/yooworld/work-backend-a/node22/bin:$PATH   # node v22.21.1 + npm
cd server && npm ci
npm run typecheck         # tsc (src + tests), 0 errors expected
npm test                  # unit + db + security + backup suites; starts its own Postgres if needed, stops it at the end
npm run test:coverage     # same + v8 coverage and SQL function coverage -> test-results/
npm run test:e2e          # wrangler dev --local + yoland_e2e: slice, resilience (incl. 500-client storm), cost, env
```
Optional environment variables (defaults in brackets) — use them to run next to another checkout without clashes:
| Variable | Effect |
|---|---|
| `YOLAND_PG_PORT` [54339] / `YOLAND_PG_DATA` [`server/.local/pgdata`] | private Postgres port / data dir |
| `E2E_PORT` [18791] | wrangler port for e2e (inspector = `E2E_PORT + 1000`) |
| `KEEP_PG=1` | do not stop Postgres at the end of a run |
| `ATTACK_N` [1000], `COST_MOVE_S` / `COST_IDLE_S` [20] | security-suite parallelism / cost-harness phase lengths |

Manual dev server (optional):
```bash
npm run db:start && npm run db:reset      # private Postgres on 127.0.0.1:54339, yoland_local with all migrations
cp .dev.vars.example .dev.vars            # local placeholders only (git-ignored)
npm run dev                               # wrangler dev --local on 127.0.0.1:8787 (no account, no deploy)
npm run db:stop
```
Expected results at 9dedf8e [MESURÉ]: typecheck OK; `npm test` 11 files / 80 tests passed; `npm run test:e2e`
4 files / 20 tests passed (≈80 s; the cost test alone ≈45 s).

## Rules enforced by the database
- Append-only ledger (`ledger_tx`, `ledger_entries`), `item_moves`, `gifts`, `reward_claims`, `trade_lines`, `audit.log`
  (UPDATE/DELETE/TRUNCATE refused for every role, including the superuser, by statement triggers).
- Double entry: each tx sums to 0 per currency (deferred constraint trigger, checked at COMMIT).
- Diamonds never move between two players (deferred trigger); there is no gift or trade line for Diamonds.
- Idempotency: one result per (operation, actor, key); a replay returns the stored result, a reused key with a
  different payload is refused (`key_reuse`).
- TEST isolation: outside prod every currency is `GOLD_TEST` / `DIAMOND_TEST`; a prod database refuses `*_TEST`
  wallets and TEST grants, a non-prod database refuses real-currency wallets. `eco.env` is immutable.
- Diamond-bought items are **tradable by default and immediately**; only `item_definitions.tradable = false` makes
  an item non-tradable. **Owner rule (Alessandro, 2026-11-20): no hold** — `eco.config['item.diamond_hold_days'] = 0`
  (status `owner_rule`). The key and the hold mechanism are kept (a value > 0 re-enables it; tested).
- Every shop purchase writes `eco.purchase_events` (append-only) with the buyer's account age at purchase time;
  `eco.account_age_days(player)` is the accessor. These are hooks for a future chargeback handler (see below).
- **Lock order (QA B2 fix, migration 0011)**: trade row → player rows (ascending id, `FOR NO KEY UPDATE`) → item
  rows (ascending id) → item definition (stock) → wallets (ascending id). Every function that touches a player's
  wallet locks the player row first. Measured with `test/db/concurrency-mixed.test.ts` [MESURÉ]: QA's probe
  (300 purchases + 300 gifts on one wallet) went from 587 deadlocks / 103 s to **0 deadlocks / 1.5 s**; a mixed
  purchase + gift + trade + grant run (462 calls) from 255 deadlocks / 60 s to **0 / 1.8 s**.
- Prestige cannot be bought (monetary event types refused); VIP is not read by any economy function.

> Note: the current client (`src/economy/purchase.ts`) marks Diamond purchases `bound: true`. Phase B does not
> change the client economy; this mismatch must be resolved when the client switches to the server economy.

## Backup / restore (tested locally: `npx vitest run test/backup`)
`scripts/backup.mjs`: consistent logical dump (one REPEATABLE READ snapshot, role `backup_ro`) of every table in
auth/eco/social/prog/mod/audit/app -> **age** encryption (X25519 recipient; private identity kept offline by the owner)
-> upload to an S3-compatible bucket with SigV4 (`scripts/s3-local.mjs` emulator here; R2 in Phase C) -> download ->
decrypt -> restore into an **empty** database (schema from the same migrations, checksums compared; data via COPY with
triggers disabled; identities reset). Also a ledger NDJSON export. The test checks reconciliation = 0, identical row
counts for all tables, identical ledger NDJSON, intact audit hash chain, and that the restored DB works.
Deviation: `pg_dump` / MinIO are not installed on this box and Phase B forbids non-npm downloads, so the dump is a
COPY-based logical dump and the object store is a local SigV4 emulator. Phase C must re-run with pg_dump/pg_restore
against Neon and a real R2 bucket.

## Cost harness (`npx vitest run -c vitest.e2e.config.ts test/e2e/cost.test.ts`)
Counts incoming/outgoing WS messages, bytes and alarms for one 25-player room (moving vs idle) and writes
`test-results/cost-harness.json` with a labelled $ ESTIMATION from Cloudflare's public DO pricing.

## Before real payments (BACKLOG — not built in Phase B)
- Chargeback / refund handler: claw back the Diamonds and the items bought with them, freeze items already given
  away or traded, flag repeat offenders (uses `eco.purchase_events`, `item_moves`, `eco.account_age_days`).
- Stored purchase evidence: 3DS result, IP, device, ToS acceptance, Diamond spend log.
- After launch: fraud-monitoring bots for first-time accounts doing mass purchases.

## Known local-runtime behaviour
- [MESURÉ] Under `wrangler dev --local`, a server-initiated WebSocket close on a socket that has never sent a single
  message is not delivered to the client (the room still drops the socket and stops sending to it). Real clients send
  moves; every server close is preceded by an explicit message (`kicked`, `error: alone`, …) so the client can close
  itself. To re-check on real Cloudflare in Phase C.
