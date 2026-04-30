# Browser LOD Demo

Run from the repo root:

```bash
npm install
npm run build
npm run demo:serve
```

Then open:

```text
http://127.0.0.1:4173/demo/browser-lod/
```

Notes:

- The demo runs through Vite and imports the browser-specific ESM build from `dist/browser`.
- SOG/WebP encoding uses the existing `lib/webp.wasm`.
- The generated bundle is previewed immediately in an embedded Spark viewer, using the same zip-based LOD bundle runtime path as the standalone Spark viewer.
- The demo uses the CPU path for SH clustering, which keeps setup simple and browser-compatible but is slower on large splats.
- For production-scale client-side LOD generation, the next optimization is a browser `createDevice` hook so `writeSog()` can use WebGPU-assisted clustering.
