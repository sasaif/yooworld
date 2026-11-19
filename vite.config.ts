/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
// plain .mjs helper shared with tools/check-save-env.mjs (vite.config is not part of the tsc project)
import { resolveSaveEnv } from './tools/save-env-rules.mjs';
// Save isolation (P0.A): the env id decides which localStorage keyspace this bundle may touch. Throws (= build fails)
// on a missing/invalid GH_PAGES_BASE or an env that does not match the folder. See docs/SAVE_ISOLATION.md.
const { base, envId } = resolveSaveEnv(process.env) as { base: string; envId: string };
const buildId = process.env.VITE_YW_BUILD_ID || (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; } })();
export default defineConfig({ base, plugins: [react()], server: { host: true },
  define: { __YW_ENV__: JSON.stringify(envId), __YW_BUILD_ID__: JSON.stringify(buildId) },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
