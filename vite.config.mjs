import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        alias: {
            '@playcanvas/splat-transform/browser': fileURLToPath(new URL('./dist/browser/index.mjs', import.meta.url))
        }
    }
});
