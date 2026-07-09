export * from '@playcanvas/splat-transform/browser';

import { WebPCodec } from '@playcanvas/splat-transform/browser';

WebPCodec.wasmUrl = new URL('../../lib/webp.wasm', import.meta.url).href;
