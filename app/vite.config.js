import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The family app, served at shopping.bkia.com.au/. `npm run build` builds
// into dist/ and copies index.html and assets/ into ../public/, which is
// committed so Vercel stays zero-config (icons, manifest, sw.js and the
// classic app in public/ are left alone).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': 'https://shopping.bkia.com.au' } },
});
