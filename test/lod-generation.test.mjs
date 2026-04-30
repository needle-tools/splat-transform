import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    estimateLodDecimateIterations,
    generateLodDataTable,
    getOutputFormat,
    MemoryFileSystem,
    WebPCodec,
    writeFile
} from '../src/lib/index.js';

import { createMinimalTestData } from './helpers/test-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
WebPCodec.wasmUrl = join(__dirname, '..', 'lib', 'webp.wasm');

describe('LOD generation helper', () => {
    it('estimates cascade decimation iterations instead of recomputing each level from scratch', () => {
        assert.strictEqual(
            estimateLodDecimateIterations(100, [1, 0.5, 0.25, 0.125]),
            3
        );
        assert.strictEqual(
            estimateLodDecimateIterations(100, [1, 0.5, 0.25, 0.125], 50),
            5
        );
    });

    it('builds descending LOD levels without mutating the source table', async () => {
        const source = createMinimalTestData();
        const result = await generateLodDataTable({
            source,
            ratios: [1, 0.5, 0.25]
        });

        assert.strictEqual(source.hasColumn('lod'), false, 'source table should stay unlabeled');
        assert.strictEqual(result.workingSource.numRows, 16);
        assert.deepStrictEqual(result.targetCounts, [16, 8, 4]);
        assert.strictEqual(result.levels.length, 3);
        assert.strictEqual(result.levels[0].numRows, 16);
        assert.strictEqual(result.levels[1].numRows, 8);
        assert.strictEqual(result.levels[2].numRows, 4);
        assert.strictEqual(result.dataTable.numRows, 28);

        const lodColumn = result.dataTable.getColumnByName('lod');
        assert.ok(lodColumn, 'combined table should include lod assignments');

        const counts = [0, 0, 0];
        for (const value of lodColumn.data) {
            counts[value] += 1;
        }
        assert.deepStrictEqual(counts, [16, 8, 4]);
    });
});

describe('writeFile auto-generates LOD bundles', () => {
    it('writes lod-meta.json from a single source when lod ratios are provided', async () => {
        const source = createMinimalTestData();
        const fs = new MemoryFileSystem();
        const options = {
            iterations: 1,
            lodSelect: [],
            unbundled: false,
            lodChunkCount: 512,
            lodChunkExtent: 16,
            lodGenerateRatios: [1, 0.5, 0.25]
        };

        await writeFile({
            filename: 'output/lod-meta.json',
            outputFormat: getOutputFormat('output/lod-meta.json', options),
            dataTable: source,
            options
        }, fs);

        const metaBytes = fs.results.get('output/lod-meta.json');
        assert.ok(metaBytes, 'lod-meta.json should be written');

        const meta = JSON.parse(new TextDecoder().decode(metaBytes));
        assert.strictEqual(meta.lodLevels, 3);
        assert.ok(Array.isArray(meta.filenames));
        assert.ok(meta.filenames.length > 0);
    });
});
