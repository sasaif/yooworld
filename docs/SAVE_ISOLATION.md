# Save isolation and safe loading (P0, `feature/save-isolation`)

Owner decisions 2026-11-19 (v1.2): every test version has completely isolated save data; no silent deletion or reset
during loading; backups and recovery before touching corrupted or incompatible data. Stable prefix **per folder**
(the build SHA is only recorded inside saves/backups as `buildId`); UI prefs (`yw.*`) are isolated too.

## Why
GitHub Pages serves every YooWorld folder from one origin (`https://sasaif.github.io`). `localStorage` and
`sessionStorage` are per origin, not per path, so before this branch `/yooworld/`, `/yooworld/polish/`,
`/yooworld/plage/` … all read and wrote the same Gold, Diamonds, inventory, apartment and looks.

## Environments (build time)
`tools/save-env-rules.mjs` (used by `vite.config.ts` and `tools/check-save-env.mjs`) resolves the env and **fails the
build** when it is ambiguous:

| Build | env id | data keys | UI prefs (local + session) |
|---|---|---|---|
| `GH_PAGES=1 GH_PAGES_BASE=/yooworld/` (main game only) | `prod` | `yooworld:<name>` (legacy, unchanged) | `yw.<name>` (legacy, unchanged) |
| `GH_PAGES=1 GH_PAGES_BASE=/yooworld/<folder>/` | `test/<folder>` | `yooworld:e:test.<folder>:<name>` | `yw:e:test.<folder>:<name>` |
| local `vite`, `vite build` without `GH_PAGES`, vitest | `dev` (or `VITE_YW_ENV=dev/<name>`) | `yooworld:e:dev:<name>` | `yw:e:dev:<name>` |

Fail-closed rules: `GH_PAGES=1` without `GH_PAGES_BASE` → error; a base other than `/yooworld/` or `/yooworld/<one-folder>/`
→ error; `VITE_YW_ENV` that does not match the folder (e.g. a subfolder as `prod`) → error; `VITE_YW_ENV=prod` outside
the Pages root build → error. `VITE_YW_BUILD_ID` defaults to `git rev-parse --short HEAD`.

## Vercel (`feature/vercel-env`)
On Vercel the base is always `/` and each production domain, branch alias (`<project>-git-<branch>-<team>.vercel.app`)
and per-deployment URL is a **separate origin**, so `localStorage` is already isolated by the browser. The env id is still
derived and baked in, so keys stay namespaced and a misconfigured build cannot reach the prod keyspace:

| Vercel build (system env vars) | env id |
|---|---|
| `VERCEL_ENV=production`, `VERCEL_GIT_COMMIT_REF=main` | `prod` |
| `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=<branch>` | `test/<slug>` (`feature/vercel-env` → `test/feature-vercel-env`, `uat` → `test/uat`) |
| `VERCEL_ENV=development` (`vercel dev`) | `dev` / `dev/<name>` |

Slug: lowercase, every run of characters outside `[a-z0-9._-]` → `-`, max 41 chars. Fail-closed (build error):
production from any branch other than `main` or without a git ref (e.g. a CLI `--prod` upload); a preview with
`VITE_YW_ENV=prod` (e.g. a project env var applied to all environments) or a `VITE_YW_ENV` that differs from its branch;
a preview without a branch or of `main`; an unknown `VERCEL_ENV`; `GH_PAGES`/`GH_PAGES_BASE` set on a Vercel build.
Verified on Vercel 2026-11-19: an API deployment of `feature/vercel-env` that Vercel targeted as production failed the build
with "Vercel production build must come from git branch main" (nothing served). Previews come from git pushes.
Do **not** add `VITE_YW_ENV` as a Vercel project env var; leave it derived. `vercel.json` pins framework `vite`,
`npm run build`, output `dist`. Check locally: `VERCEL=1 VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=uat node tools/check-save-env.mjs`.

## Runtime
- `src/persistence/saveEnv.ts`: env id, prefixes, `isProdKey`.
- `src/persistence/prefixedKV.ts` (`EnvKV`): callers pass logical names (`profile`, `eco:dev`, `camView`). A full key or
  any name that would resolve into the production keyspace **throws** in a non-prod env; prod refuses `yooworld:e:*`.
- `src/persistence/storage.ts`: the only module that touches `localStorage` / `sessionStorage`
  (`storage.data`, `storage.prefs`, `storage.session`). `tests/save-env.test.ts` fails if any other file in `src/` does.
  `?fresh/?shot/?thumbs`: saves + economy in memory; prefs stay persistent (namespaced) so capture tools work.
- No IndexedDB is used. If it is ever added, its database name must include the env tag.

## Safe loading (P0.B)
- Missing record → starter created (first install only). Corrupt JSON, newer schema, or wrong shape → `SaveLoadError`:
  **nothing is written**, raw bytes copied to `backup:raw:<key>` (≤ 5 distinct copies, never overwritten), and the
  recovery panel (`src/ui/SaveRecovery.tsx`) opens: restore last valid snapshot / temporary session (memory only) /
  download raw save / start fresh TEST data (explicit confirm; the raw copy stays).
- Economy (`eco:dev`) corrupt or `version ≠ 1`: kept byte-identical, economy runs read-only in memory, same panel.
- Unknown furniture: hidden from the room (`GameController.quarantine`) but always written back with the layout.
  Unknown inventory counts stay in the map. Unknown look ids: moved to `q` in the stored look and restored by a build
  that knows them (dropped only if the player explicitly picks another item for that slot). Owned ids unknown to the
  catalogue stay owned (`owns()`).
- Snapshots (`backup:snap`, ring of 3, deduplicated): clean boot, before an upgraded (v0 → v1) write, before explicit
  resets (`resetSave`, `resetDev`) and before a restore. Envelopes now carry `env` and `buildId`.
- Ledger: no more `slice(-500)`; older entries move to `wallet.archive`, still used by `hasTx` and `audit()`.
- Out of scope (unchanged): prices, rarity labels, tradability, balances, coin migration.

## Verification
`node tools/e2e-save-isolation.mjs --build`: one local origin, `/yooworld/` (prod) + `/yooworld/combined-1/`.
A: seed root keys, play/buy/save in combined-1 (no `?fresh`), every root key byte-identical, no new root key, combined-1
keys changed. B: the reverse. C: build guards. D: prod root with corrupt / newer saves → recovery panel, nothing written,
temporary session leaves every key byte-identical. Required green before any publish.

## Known limits
- Folders already published before this branch (`/yooworld/polish/`, `/plage/`, `/fashion/` …) still use the shared
  root keys until they are rebuilt from a branch that contains this code. Visiting them can still modify the main
  game's save. The main game itself must also be rebuilt from this code to get safe loading.
- When a test folder is rebuilt with isolation, its testers start from an empty test save (nothing is copied from root).
- Same-origin namespacing is not a security boundary (script in one folder can read all keys); a separate origin
  (subdomain) would be stronger and needs owner approval.
- `localStorage` quota (~5 MB): snapshots + archived ledger grow the save; a refused backup write is logged, not fatal.
