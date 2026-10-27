import { defineConfig } from 'vite';

export default defineConfig({
  build: { rollupOptions: { input: { obs: 'index.html', config: 'config.html', transition: 'transition.html' } } },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:5180' },
      '/ws': { target: 'ws://127.0.0.1:5180', ws: true },
    },
  },
});
