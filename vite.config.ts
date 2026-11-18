/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: process.env.GH_PAGES ? '/yooworld/' : '/', plugins: [react()], server: { host: true }, test: { environment: 'node', include: ['tests/**/*.test.ts'] } });
