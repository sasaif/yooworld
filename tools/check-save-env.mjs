#!/usr/bin/env node
// Pre-build / pre-deploy guard: prints the resolved save env or exits non-zero (fail closed).
// usage: GH_PAGES=1 GH_PAGES_BASE=/yooworld/combined-1/ node tools/check-save-env.mjs
import { resolveSaveEnv } from './save-env-rules.mjs';
try { const r = resolveSaveEnv(process.env); console.log(`save env OK: base=${r.base} env=${r.envId}`); }
catch (e) { console.error(String(e.message ?? e)); process.exit(1); }
