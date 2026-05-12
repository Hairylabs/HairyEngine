import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: { entry: 'src/main/index.ts' },
      // Watch enables auto-rebuild + electron restart on main-process edits in dev.
      watch: {},
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: { entry: 'src/preload/index.ts' },
      watch: {},
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
  },
});
