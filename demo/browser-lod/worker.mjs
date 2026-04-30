import {
    generateLodDataTable,
    MemoryFileSystem,
    MemoryReadFileSystem,
    TextRenderer,
    getInputFormat,
    getOutputFormat,
    logger,
    readFile,
    writeFile
} from './splat-transform-browser.mjs';

const textRenderer = new TextRenderer({
    write: (chunk) => self.postMessage({ type: 'log-chunk', chunk }),
    output: (chunk) => self.postMessage({ type: 'log-chunk', chunk })
});

logger.setRenderer({
    handle(event) {
        textRenderer.handle(event);
        self.postMessage({ type: 'log-event', event });
    }
});
logger.setVerbosity('normal');

const sampleParams = [
    { name: 'width', value: '64' },
    { name: 'height', value: '64' },
    { name: 'spacing', value: '0.18' },
    { name: 'scale', value: '0.11' },
    { name: 'r', value: '0.2' },
    { name: 'g', value: '0.7' },
    { name: 'b', value: '1.0' },
    { name: 'a', value: '0.95' }
];

const readOptions = {
    iterations: 10,
    lodSelect: [],
    unbundled: false,
    lodChunkCount: 512,
    lodChunkExtent: 16
};

const loadSourceTable = async (source) => {
    if (source.kind === 'sample') {
        const tables = await readFile({
            filename: '/generators/gen-grid.mjs',
            inputFormat: getInputFormat('/generators/gen-grid.mjs'),
            options: readOptions,
            params: sampleParams,
            fileSystem: new MemoryReadFileSystem()
        });
        return {
            name: source.name ?? 'Generated grid sample',
            table: tables[0]
        };
    }

    const readFs = new MemoryReadFileSystem();
    readFs.set(source.name, source.bytes);

    const tables = await readFile({
        filename: source.name,
        inputFormat: getInputFormat(source.name),
        options: readOptions,
        params: [],
        fileSystem: readFs
    });

    return {
        name: source.name,
        table: tables[0]
    };
};

const transferFiles = (files) => {
    const transfers = [];
    const payload = files.map(({ name, bytes }) => {
        transfers.push(bytes.buffer);
        return { name, bytes };
    });
    return { payload, transfers };
};

self.onmessage = async ({ data }) => {
    const { requestId, type } = data;

    try {
        if (type === 'inspect-source') {
            const { name, table } = await loadSourceTable(data.source);
            self.postMessage({
                type: 'source-inspected',
                requestId,
                sourceName: name,
                sourceRows: table.numRows
            });
            return;
        }

        if (type === 'generate-lod-bundle') {
            const { name, table } = await loadSourceTable(data.source);
            const generation = await generateLodDataTable({
                source: table,
                ratios: data.ratios,
                preDecimateCount: data.preDecimateCount ?? null
            });
            const outputFs = new MemoryFileSystem();
            const options = {
                iterations: data.iterations,
                lodSelect: [],
                unbundled: false,
                lodChunkCount: data.chunkCount,
                lodChunkExtent: data.chunkExtent,
                lodGenerateRatios: data.ratios,
                lodPreDecimateCount: data.preDecimateCount ?? undefined
            };
            const filename = 'browser-output/lod-meta.json';

            await writeFile({
                filename,
                outputFormat: getOutputFormat(filename, options),
                dataTable: generation.dataTable,
                options
            }, outputFs);

            const files = [...outputFs.results.entries()]
                .map(([fileName, bytes]) => ({ name: fileName, bytes }))
                .sort((a, b) => a.name.localeCompare(b.name));

            const { payload, transfers } = transferFiles(files);
            self.postMessage({
                type: 'generation-complete',
                requestId,
                sourceName: name,
                sourceRows: table.numRows,
                workingRows: generation.workingSource.numRows,
                outputRows: generation.dataTable.numRows,
                files: payload
            }, { transfer: transfers });
            return;
        }

        throw new Error(`Unknown worker request type: ${type}`);
    } catch (error) {
        logger.unwindAll(true);
        self.postMessage({
            type: 'request-error',
            requestId,
            message: error instanceof Error ? error.message : String(error)
        });
    }
};
