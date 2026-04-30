import { combine, DataTable } from './data-table';
import { processDataTable, type ProcessOptions } from './process';
import { logger } from './utils';

type LodGenerationOptions = {
    source: DataTable;
    ratios: number[];
    preDecimateCount?: number | null;
    processOptions?: ProcessOptions;
};

type LodGenerationResult = {
    workingSource: DataTable;
    levels: DataTable[];
    dataTable: DataTable;
    ratios: number[];
    targetCounts: number[];
};

const normalizeLodRatios = (ratios: number[]) => {
    const filtered = ratios
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0 && value <= 1);

    if (filtered.length === 0) {
        throw new Error('Enter at least one ratio between 0 and 1.');
    }

    const normalized = filtered[0] === 1 ? filtered : [1, ...filtered];
    for (let i = 1; i < normalized.length; i += 1) {
        if (normalized[i] > normalized[i - 1]) {
            throw new Error('LOD ratios must stay in descending order.');
        }
    }

    return normalized;
};

const estimateLodDecimateIterations = (sourceRows: number, ratios: number[], preDecimateCount?: number | null) => {
    if (!Number.isFinite(sourceRows) || sourceRows <= 0) {
        return 0;
    }

    const normalizedRatios = normalizeLodRatios(ratios);
    let total = 0;
    let currentRows = sourceRows;

    if (preDecimateCount && preDecimateCount > 0 && preDecimateCount < currentRows) {
        total += Math.max(1, Math.ceil(Math.log2(currentRows / preDecimateCount)));
        currentRows = preDecimateCount;
    }

    const baseRows = currentRows;
    for (const ratio of normalizedRatios) {
        const targetRows = Math.max(1, Math.round(baseRows * ratio));
        if (targetRows < currentRows) {
            total += Math.max(1, Math.ceil(Math.log2(currentRows / targetRows)));
            currentRows = targetRows;
        }
    }

    return total;
};

const generateLodDataTable = async (options: LodGenerationOptions): Promise<LodGenerationResult> => {
    const { source, preDecimateCount = null, processOptions } = options;
    const ratios = normalizeLodRatios(options.ratios);

    let workingSource = source;
    if (preDecimateCount && preDecimateCount > 0 && preDecimateCount < source.numRows) {
        logger.output(`Pre-decimating ${source.numRows.toLocaleString()} rows to ${preDecimateCount.toLocaleString()} rows`);
        workingSource = await processDataTable(source.clone(), [{
            kind: 'decimate',
            count: preDecimateCount,
            percent: null
        }], processOptions);
        logger.output(`Pre-decimated source: ${workingSource.numRows.toLocaleString()} rows`);
    }

    logger.output(`Generating ${ratios.length} LOD levels from ${workingSource.numRows.toLocaleString()} rows`);

    const levels: DataTable[] = [];
    const targetCounts: number[] = [];
    const baseRows = workingSource.numRows;
    let current = workingSource;

    for (let index = 0; index < ratios.length; index += 1) {
        const ratio = ratios[index];
        const targetCount = Math.max(1, Math.round(baseRows * ratio));
        targetCounts.push(targetCount);

        if (targetCount < current.numRows) {
            current = await processDataTable(current, [{
                kind: 'decimate',
                count: targetCount,
                percent: null
            }], processOptions);
        }

        const taggedLevel = await processDataTable(current.clone(), [{
            kind: 'lod',
            value: index
        }], processOptions);

        logger.output(`LOD ${index}: ${taggedLevel.numRows.toLocaleString()} rows`);
        levels.push(taggedLevel);
    }

    return {
        workingSource,
        levels,
        dataTable: combine(levels),
        ratios,
        targetCounts
    };
};

export {
    estimateLodDecimateIterations,
    generateLodDataTable,
    normalizeLodRatios,
    type LodGenerationOptions,
    type LodGenerationResult
};
