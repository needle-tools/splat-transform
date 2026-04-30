import { describe, it } from "node:test";
import assert from "node:assert";

import { createPackedSubset } from "../demo/browser-lod/spark-splat-bundle.mjs";

describe("Spark preview subset packing", () => {
    it("pads small subset arrays so Spark preserves lower LOD splat counts", () => {
        const decoded = {
            packedArray: new Uint32Array(1024 * 4),
            numSplats: 1024,
            extra: {},
            splatEncoding: {}
        };

        const subset = createPackedSubset({
            decoded,
            ranges: [{ offset: 0, count: 1024 }]
        });

        assert.strictEqual(subset.numSplats, 1024);
        assert.strictEqual(subset.packedArray.length, 2048 * 4);
    });

    it("pads tiny subsets below one Spark texture row", () => {
        const decoded = {
            packedArray: new Uint32Array(512 * 4),
            numSplats: 512,
            extra: {},
            splatEncoding: {}
        };

        const subset = createPackedSubset({
            decoded,
            ranges: [{ offset: 0, count: 512 }]
        });

        assert.strictEqual(subset.numSplats, 512);
        assert.strictEqual(subset.packedArray.length, 2048 * 4);
    });
});
