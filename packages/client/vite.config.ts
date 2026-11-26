import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  build: {
    target: 'es2022',
    // The game and the standing credits page.
    rolldownOptions: { input: { main: page('index.html'), credits: page('credits.html') } },
  },
  // `pnpm dev` here proxies the API run with `pnpm start` at the repo root.
  server: { proxy: { '/api': 'http://localhost:8080' } },
});
