# YoLand backend — `server/` (Phase B, LOCAL ONLY)

Backend foundation for YoLand: one API Worker (Hono) + Durable Objects for rooms (later milestone) +
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
| `src/core/economy.ts` | `EconomyGate` interface + Postgres implementation (1 SQL call per operation). |
| `src/core/productRules.ts` | Product rules and their approval status (source of truth: `eco.config`). |
| `src/cf/worker.ts` | API Worker entry (health only in milestone 1). |
| `../shared/` | Types shared with the client (protocol, economy). |
| `scripts/pg-local.mjs` | Private local Postgres 18 (embedded binaries), `server/.local/pgdata`, port 54339. |
| `scripts/migrate.mjs` | Migration runner (checksums, env tag, refuses prod and non-loopback hosts). |

## Commands
```bash
cd server && npm ci
npm run db:start          # private Postgres on 127.0.0.1:54339
npm run db:reset          # recreate yoland_local and apply all migrations (env=local)
npm test                  # unit + db + security suites (creates yoland_test; stops Postgres at the end if it started it)
npm run test:security     # 1000-parallel attack suite only (ATTACK_N=... to change)
npm run test:coverage     # + TS coverage (v8) and SQL function coverage -> test-results/
npm run typecheck
npm run dev               # wrangler dev --local (no account, no deploy)
npm run db:stop
```

## Rules enforced by the database
- Append-only ledger (`ledger_tx`, `ledger_entries`), `item_moves`, `gifts`, `reward_claims`, `trade_lines`, `audit.log`
  (UPDATE/DELETE/TRUNCATE refused for every role, including the superuser, by statement triggers).
- Double entry: each tx sums to 0 per currency (deferred constraint trigger, checked at COMMIT).
- Diamonds never move between two players (deferred trigger); there is no gift or trade line for Diamonds.
- Idempotency: one result per (operation, actor, key); a replay returns the stored result, a reused key with a
  different payload is refused (`key_reuse`).
- TEST isolation: outside prod every currency is `GOLD_TEST` / `DIAMOND_TEST`; a prod database refuses `*_TEST`
  wallets and TEST grants, a non-prod database refuses real-currency wallets. `eco.env` is immutable.
- Diamond-bought items are **tradable by default**; only `item_definitions.tradable = false` makes an item
  non-tradable. The 14-day hold is `eco.config['item.diamond_hold_days']` (pending approval, 0 disables).
- Prestige cannot be bought (monetary event types refused); VIP is not read by any economy function.

> Note: the current client (`src/economy/purchase.ts`) marks Diamond purchases `bound: true`. Phase B does not
> change the client economy; this mismatch must be resolved when the client switches to the server economy.
