import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 6769,
    proxy: {
      '/api': 'http://localhost:6767',
    },
  },
});
