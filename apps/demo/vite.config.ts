import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The core is source, not a build artifact: aliasing it straight at the entry file means one
// dev server, one HMR graph, and a stack trace that points at the real line in the generator.
export default defineConfig({
  resolve: {
    alias: { '@everydoor/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)) },
  },
  server: { port: 5180 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
