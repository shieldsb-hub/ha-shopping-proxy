import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Trial build: served at shopping.bkia.com.au/next/ beside the current app.
// Built output is committed (public/next/) so Vercel stays zero-config.
// For the cutover, change base to '/' and outDir to '../public'.
export default defineConfig({
  plugins: [react()],
  base: '/next/',
  build: { outDir: '../public/next', emptyOutDir: true },
  server: { proxy: { '/api': 'https://shopping.bkia.com.au' } },
});
