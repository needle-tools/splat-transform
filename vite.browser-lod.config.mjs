import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    root: fileURLToPath(new URL('./demo/browser-lod', import.meta.url)),
    base: './',
    publicDir: false,
    build: {
        outDir: fileURLToPath(new URL('./build/browser-lod', import.meta.url)),
        emptyOutDir: true
    },
    resolve: {
        alias: {
            '@playcanvas/splat-transform/browser': fileURLToPath(new URL('./dist/browser/index.mjs', import.meta.url))
        }
    }
});
