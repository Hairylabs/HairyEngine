import { defineConfig } from 'vite';
import { resolve } from 'path';

// Standalone web build of the engine runtime. Produces a directory you can
// upload to any static host or zip + share. No Electron, no editor UI.
//
// Usage: npm run web:build  -> outputs to dist-web/

export default defineConfig({
  root: 'src/web',
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'src/web/index.html'),
    },
  },
});
