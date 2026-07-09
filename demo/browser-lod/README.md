# Browser LOD Demo

Run from the repo root:

```bash
npm install
npm run demo:dev
```

Then open:

```text
http://127.0.0.1:4173/demo/browser-lod/
```

Notes:

- `npm run demo:dev` builds the browser bundle first, then starts Vite.
- The demo runs through Vite and imports the browser-specific ESM build from `dist/browser`.
- SOG/WebP encoding uses the existing `lib/webp.wasm`.
- The generated bundle is previewed immediately in an embedded Spark viewer, using the same zip-based LOD bundle runtime path as the standalone Spark viewer.
- The demo uses the CPU path for SH clustering, which keeps setup simple and browser-compatible but is slower on large splats.
- For production-scale client-side LOD generation, the next optimization is a browser `createDevice` hook so `writeSog()` can use WebGPU-assisted clustering.

For a deployable top-level static build:

```bash
npm run build:lods
```

This writes a standalone site to `build/browser-lod/` with `index.html` at the top level, so you can deploy it directly, for example:

```bash
npx needle-cloud deploy build/browser-lod
```

For local testing of that top-level version:

```bash
npm run lods:dev
```
