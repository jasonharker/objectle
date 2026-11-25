import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  // `pnpm dev` here proxies the API run with `pnpm start` at the repo root.
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
