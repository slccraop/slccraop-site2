import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const isSample = (mode: string) => mode === 'sample';
const isWorkersDeploy = () => (process.env.DEPLOY_TARGET ?? '').toLowerCase() === 'workers';

// GitHub Pages hosts this project under /slccraop-site2/, while Cloudflare Workers deploys at the site root.
// Use DEPLOY_TARGET=workers for the Worker build and DEPLOY_TARGET=pages (default in Pages workflow) for GitHub Pages.
export default defineConfig(({ mode }) => {
  const sample = isSample(mode);
  const base = isWorkersDeploy() ? '/' : sample ? './' : '/slccraop-site2/';

  return {
    plugins: [react()],
    base,
    build: {
      target: 'es2020',
      sourcemap: false,
      assetsInlineLimit: 0,
      outDir: sample ? 'preview' : 'dist',
      cssCodeSplit: !sample,
      ...(sample
        ? { rollupOptions: { output: { format: 'iife' as const, inlineDynamicImports: true } } }
        : {}),
    },
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
  };
});
