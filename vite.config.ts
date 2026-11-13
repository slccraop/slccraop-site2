import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// assetsInlineLimit 0: nothing is inlined as a data: URI, so the CSP never needs `data:` for fonts or images.
// mode "sample" (npm run build:sample) builds a double-click preview into /preview with FAKE data. It is never deployed.
export default defineConfig(({ mode }) => {
  const sample = mode === 'sample';
  return {
    plugins: [react()],
    base: sample ? './' : '/',
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
