import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    chooseAutoLodLevel,
    pickLevel
} from "../demo/browser-lod/lod-selection.mjs";

describe("browser LOD selection helper", () => {
    it("picks the nearest available explicit level", () => {
        assert.strictEqual(pickLevel([0, 2, 4], 3), 2);
        assert.strictEqual(pickLevel([0, 2, 4], 4), 4);
    });

    it("matches PlayCanvas-style distance thresholds", () => {
        const availableLevels = [0, 1, 2, 3];

        assert.strictEqual(chooseAutoLodLevel({
            availableLevels,
            lodLevels: 4,
            distance: 4.9,
            cameraFovDegrees: 45,
            cameraAspect: 1,
            lodBaseDistance: 5,
            lodMultiplier: 3
        }), 0);

        assert.strictEqual(chooseAutoLodLevel({
            availableLevels,
            lodLevels: 4,
            distance: 5,
            cameraFovDegrees: 45,
            cameraAspect: 1,
            lodBaseDistance: 5,
            lodMultiplier: 3
        }), 1);

        assert.strictEqual(chooseAutoLodLevel({
            availableLevels,
            lodLevels: 4,
            distance: 15,
            cameraFovDegrees: 45,
            cameraAspect: 1,
            lodBaseDistance: 5,
            lodMultiplier: 3
        }), 2);
    });
});
