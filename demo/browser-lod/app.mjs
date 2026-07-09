import { unzipSync, zipSync } from "fflate";
import {
    estimateLodDecimateIterations,
    getOutputFormat,
    normalizeLodRatios,
    version
} from "./splat-transform-browser.mjs";
import { createPlayCanvasPreview } from "./playcanvas-preview.mjs";
import { createSparkPreview } from "./spark-lod-runtime.mjs";

const sourceValue = document.querySelector('#sourceValue');
const rowsValue = document.querySelector('#rowsValue');
const outputValue = document.querySelector('#outputValue');
const stateValue = document.querySelector('#stateValue');
const viewerDropZone = document.querySelector('#viewerDropZone');
const filesList = document.querySelector('#filesList');
const filesSummary = document.querySelector('#filesSummary');
const logEl = document.querySelector('#log');
const zipButton = document.querySelector('#zipButton');
const progressStage = document.querySelector('#progressStage');
const progressSpinner = document.querySelector('#progressSpinner');
const progressPercent = document.querySelector('#progressPercent');
const progressFill = document.querySelector('#progressFill');
const progressDetail = document.querySelector('#progressDetail');
const progressElapsed = document.querySelector('#progressElapsed');
const progressRemaining = document.querySelector('#progressRemaining');
const progressMode = document.querySelector('#progressMode');
const ratiosInput = document.querySelector('#ratiosInput');
const iterationsInput = document.querySelector('#iterationsInput');
const chunkCountInput = document.querySelector('#chunkCountInput');
const chunkExtentInput = document.querySelector('#chunkExtentInput');
const preDecimateInput = document.querySelector('#preDecimateInput');
const outputFormatSelect = document.querySelector('#outputFormatSelect');
const formatIdentityValue = document.querySelector('#formatIdentityValue');
const spzVersionLabel = document.querySelector('#spzVersionLabel');
const spzVersionSelect = document.querySelector('#spzVersionSelect');
const formatOptionsList = document.querySelector('#formatOptionsList');
const convertButton = document.querySelector('#convertButton');
const conversionHint = document.querySelector('#conversionHint');
const fileInput = document.querySelector('#fileInput');
const sampleButton = document.querySelector('#sampleButton');
const runButton = document.querySelector('#runButton');
const sparkCanvas = document.querySelector('#sparkCanvas');
const lodModeSelect = document.querySelector('#lodModeSelect');
const lodDebugCheckbox = document.querySelector('#lodDebugCheckbox');
const lodBaseDistanceInput = document.querySelector('#lodBaseDistanceInput');
const lodMultiplierInput = document.querySelector('#lodMultiplierInput');
const viewerStats = document.querySelector('#viewerStats');
const viewerError = document.querySelector('#viewerError');
const viewerEmpty = document.querySelector('#viewerEmpty');
const playcanvasFrame = document.querySelector('#playcanvasFrame');
const playcanvasStatus = document.querySelector('#playcanvasStatus');

const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
let nextRequestId = 1;
const pendingRequests = new Map();

const outputTargets = [
    {
        key: 'ply',
        label: '.ply',
        family: 'Single-file interchange format',
        buildFilename: (stem) => `browser-output/${stem}.ply`,
        preview: 'plain',
        supportText: 'Previews in Spark and PlayCanvas.',
        optionLabels: ['No extra format options.']
    },
    {
        key: 'compressed-ply',
        label: '.compressed.ply',
        family: 'Single-file interchange format',
        buildFilename: (stem) => `browser-output/${stem}.compressed.ply`,
        preview: 'plain',
        supportText: 'Previews in Spark and PlayCanvas.',
        optionLabels: ['No extra format options.']
    },
    {
        key: 'spz',
        label: '.spz',
        family: 'Single-file SPZ format',
        buildFilename: (stem) => `browser-output/${stem}.spz`,
        preview: 'plain',
        supportText: 'Previews in Spark when the embedded viewer supports the selected SPZ version. PlayCanvas does not preview plain SPZ in this demo.',
        optionLabels: ['SPZ version']
    },
    {
        key: 'sog-bundle',
        label: '.sog',
        family: 'Single-file SOG format',
        buildFilename: (stem) => `browser-output/${stem}.sog`,
        preview: 'plain',
        supportText: 'Previews in Spark and PlayCanvas.',
        optionLabels: ['SH iterations']
    },
    {
        key: 'sog',
        label: 'SOG asset set',
        family: 'Multi-file SOG packaging',
        buildFilename: () => 'browser-output/meta.json',
        preview: 'asset-files',
        previewEntry: 'browser-output/meta.json',
        supportText: 'Writes a single-resolution multi-file SOG asset set (entry file: meta.json). This does not generate extra LOD levels and is not an SPZ format. Previews in PlayCanvas.',
        optionLabels: ['SH iterations']
    },
    {
        key: 'lod',
        label: 'LOD bundle',
        family: 'Multi-file LOD packaging (SOG chunk payloads)',
        buildFilename: () => 'browser-output/lod-meta.json',
        preview: 'bundle',
        supportText: 'Generates multiple LOD levels using the ratios above, then writes a multi-file LOD bundle (entry file: lod-meta.json). This is not an SPZ format, so SPZ version does not apply. Previews in Spark and PlayCanvas.',
        optionLabels: ['LOD ratios', 'SH iterations', 'Chunk size', 'Chunk extent', 'Pre-decimate to']
    },
    {
        key: 'glb',
        label: '.glb',
        family: 'Single-file export format',
        buildFilename: (stem) => `browser-output/${stem}.glb`,
        preview: 'none',
        supportText: 'Exports correctly, but the embedded viewers do not preview GLB here.',
        optionLabels: ['No extra format options.']
    },
    {
        key: 'csv',
        label: '.csv',
        family: 'Single-file export format',
        buildFilename: (stem) => `browser-output/${stem}.csv`,
        preview: 'none',
        supportText: 'Exports correctly as tabular data, but the viewers do not preview CSV.',
        optionLabels: ['No extra format options.']
    },
    {
        key: 'html-bundle',
        label: '.html',
        family: 'Single-file export format',
        buildFilename: (stem) => `browser-output/${stem}.html`,
        preview: 'none',
        supportText: 'Exports correctly as an HTML bundle, but the embedded viewers do not run it inline.',
        optionLabels: ['SH iterations']
    },
    {
        key: 'voxel',
        label: '.voxel.json',
        family: 'Single-file export format',
        buildFilename: (stem) => `browser-output/${stem}.voxel.json`,
        preview: 'none',
        supportText: 'Exports correctly as voxel data, but the viewers do not preview voxel JSON.',
        optionLabels: ['No extra format options.']
    }
];
const outputTargetMap = new Map(outputTargets.map((target) => [target.key, target]));
const defaultButtonLabels = {
    convert: convertButton.textContent,
    run: runButton.textContent,
    sample: sampleButton.textContent
};

const state = {
    sourceName: null,
    sourceRows: null,
    sourceDescriptor: null,
    files: [],
    archiveBytes: null,
    archiveName: "splat-transform-lod.zip"
};

const testState = globalThis.__browserLodDemoState = {
    state: 'Idle',
    libraryVersion: version,
    sourceName: null,
    sourceRows: null,
    outputFiles: 0,
    outputBytes: 0,
    outputLabel: '-',
    zipDownloads: 0,
    lastArchiveName: null,
    progressPercent: 0,
    progressElapsedMs: 0,
    progressRemainingMs: null,
    progressStage: 'Idle',
    progressDetail: 'Choose a source to begin.',
    progressMode: 'Waiting',
    sparkLoaded: false,
    sparkBundleKind: null,
    sparkMode: null,
    sparkDebugColorLods: false,
    sparkLodBaseDistance: null,
    sparkLodMultiplier: null,
    sparkStats: null,
    sparkActiveMeshSplats: [],
    sparkError: null,
    playcanvasLoaded: false,
    playcanvasBundlePath: null,
    playcanvasError: null
};

const sparkPreview = createSparkPreview({
    canvas: sparkCanvas,
    lodModeSelect,
    lodDebugCheckbox,
    lodBaseDistanceInput,
    lodMultiplierInput,
    statsEl: viewerStats,
    errorEl: viewerError,
    emptyEl: viewerEmpty,
    onStateChange(nextState) {
        testState.sparkLoaded = nextState.loaded;
        testState.sparkBundleKind = nextState.bundleKind;
        testState.sparkMode = nextState.mode;
        testState.sparkDebugColorLods = nextState.debugColorLods;
        testState.sparkLodBaseDistance = nextState.lodBaseDistance;
        testState.sparkLodMultiplier = nextState.lodMultiplier;
        testState.sparkStats = nextState.stats;
        testState.sparkActiveMeshSplats = nextState.activeMeshSplats;
        testState.sparkError = nextState.error;
    }
});

const playcanvasPreview = createPlayCanvasPreview({
    iframe: playcanvasFrame,
    statusEl: playcanvasStatus,
    onStateChange(nextState) {
        testState.playcanvasLoaded = nextState.loaded;
        testState.playcanvasBundlePath = nextState.bundlePath;
        testState.playcanvasError = nextState.error;
    }
});

const formatDuration = (ms) => {
    if (!Number.isFinite(ms) || ms < 0) {
        return '--:--';
    }

    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const progressState = {
    active: false,
    runMode: 'Waiting',
    stage: 'Idle',
    detail: 'Choose a source to begin.',
    percent: 0,
    startTime: 0,
    elapsedMs: 0,
    remainingMs: null,
    decimateExpected: 0,
    decimateDone: 0,
    activeIterationProgress: 0,
    writingTotal: 0,
    writingDone: 0,
    writingProgress: 0,
    activeScopeNames: [],
    currentWritingName: null,
    timerId: null
};

const updateProgressUi = () => {
    progressStage.textContent = progressState.stage;
    progressDetail.textContent = progressState.detail;
    progressPercent.textContent = `${Math.round(progressState.percent)}%`;
    progressFill.style.width = `${progressState.percent.toFixed(1)}%`;
    progressElapsed.textContent = formatDuration(progressState.elapsedMs);
    progressRemaining.textContent = progressState.remainingMs === null ? '--:--' : formatDuration(progressState.remainingMs);
    progressMode.textContent = progressState.runMode;
    progressSpinner.hidden = !progressState.active;

    testState.progressPercent = progressState.percent;
    testState.progressElapsedMs = progressState.elapsedMs;
    testState.progressRemainingMs = progressState.remainingMs;
    testState.progressStage = progressState.stage;
    testState.progressDetail = progressState.detail;
    testState.progressMode = progressState.runMode;

    updateBusyUi();
};

const updateBusyUi = () => {
    viewerDropZone.setAttribute('aria-busy', progressState.active ? 'true' : 'false');
    convertButton.textContent = progressState.active && progressState.runMode === 'Converting' ? 'Converting...' : defaultButtonLabels.convert;
    runButton.textContent = progressState.active && progressState.runMode === 'Generating' ? 'Generating...' : defaultButtonLabels.run;
    sampleButton.textContent = progressState.active && progressState.runMode === 'Loading' ? 'Loading...' : defaultButtonLabels.sample;
};

const recomputeProgress = () => {
    const hasDecimateWork = progressState.decimateExpected > 0;
    const hasWritingWork = progressState.writingTotal > 0;
    const decimateWeight = hasDecimateWork ? 0.9 : 0;
    const writingWeight = hasDecimateWork ? 0.1 : 1;
    const decimateFraction = hasDecimateWork ?
        clamp01((progressState.decimateDone + progressState.activeIterationProgress) / progressState.decimateExpected) :
        0;
    const writingFraction = hasWritingWork ?
        clamp01((progressState.writingDone + progressState.writingProgress) / progressState.writingTotal) :
        0;

    let percent = 0;
    if (progressState.active) {
        percent = ((decimateFraction * decimateWeight) + (writingFraction * writingWeight)) * 100;
        if (progressState.writingDone >= progressState.writingTotal && hasWritingWork) {
            percent = 100;
        }
    }

    progressState.percent = Math.min(100, Math.max(progressState.percent, percent));
};

const refreshProgressClock = () => {
    if (progressState.startTime === 0) {
        progressState.elapsedMs = 0;
        progressState.remainingMs = null;
        updateProgressUi();
        return;
    }

    progressState.elapsedMs = performance.now() - progressState.startTime;
    if (progressState.active) {
        const fraction = clamp01(progressState.percent / 100);
        progressState.remainingMs = fraction > 0.01 ?
            (progressState.elapsedMs * (1 - fraction)) / fraction :
            null;
    } else {
        progressState.remainingMs = null;
    }
    updateProgressUi();
};

const stopProgressTimer = () => {
    if (progressState.timerId !== null) {
        clearInterval(progressState.timerId);
        progressState.timerId = null;
    }
};

const startProgressTimer = () => {
    stopProgressTimer();
    progressState.timerId = globalThis.setInterval(refreshProgressClock, 1000);
};

const resetProgress = (overrides = {}) => {
    stopProgressTimer();
    Object.assign(progressState, {
        active: false,
        runMode: 'Waiting',
        stage: 'Idle',
        detail: 'Choose a source to begin.',
        percent: 0,
        startTime: 0,
        elapsedMs: 0,
        remainingMs: null,
        decimateExpected: 0,
        decimateDone: 0,
        activeIterationProgress: 0,
        writingTotal: 0,
        writingDone: 0,
        writingProgress: 0,
        activeScopeNames: [],
        currentWritingName: null
    }, overrides);
    updateProgressUi();
};

const beginProgressRun = ({ runMode, stage, detail, decimateExpected = 0 }) => {
    stopProgressTimer();
    Object.assign(progressState, {
        active: true,
        runMode,
        stage,
        detail,
        percent: 0,
        startTime: performance.now(),
        elapsedMs: 0,
        remainingMs: null,
        decimateExpected,
        decimateDone: 0,
        activeIterationProgress: 0,
        writingTotal: 0,
        writingDone: 0,
        writingProgress: 0,
        activeScopeNames: [],
        currentWritingName: null
    });
    recomputeProgress();
    refreshProgressClock();
    startProgressTimer();
};

const finishProgressRun = (detail) => {
    progressState.active = false;
    progressState.stage = 'Done';
    progressState.runMode = 'Complete';
    progressState.detail = detail;
    progressState.percent = 100;
    refreshProgressClock();
    stopProgressTimer();
};

const failProgressRun = (detail) => {
    progressState.active = false;
    progressState.stage = 'Error';
    progressState.runMode = 'Failed';
    progressState.detail = detail;
    refreshProgressClock();
    stopProgressTimer();
};

const getIterationBarProgress = (name, fraction) => {
    const clamped = clamp01(fraction);
    if (name === 'Finding nearest neighbors') {
        return 0.08 + clamped * 0.57;
    }
    if (name === 'Computing edge costs') {
        return 0.65 + clamped * 0.17;
    }
    if (name === 'Merging splats') {
        return 0.82 + clamped * 0.18;
    }
    return clamped;
};

const isWritingScopeName = (name) => name === 'env' || /^\d+_\d+$/.test(name);

const progressTracker = {
    handle(event) {
        if (!progressState.active) {
            return;
        }

        if (event.kind === 'scopeStart') {
            progressState.activeScopeNames.length = event.depth;
            progressState.activeScopeNames[event.depth] = event.name;

            if (event.name === 'Decimate iteration') {
                progressState.runMode = 'Generating';
                progressState.stage = 'Generating LODs';
                progressState.activeIterationProgress = 0;
                progressState.detail = event.index && event.total ?
                    `Decimate iteration ${event.index} of ${event.total}` :
                    'Decimate iteration';
            } else if (event.name === 'Building KD-tree' && progressState.activeScopeNames.includes('Decimate iteration')) {
                progressState.detail = 'Building KD-tree';
                progressState.activeIterationProgress = Math.max(progressState.activeIterationProgress, 0.08);
            } else if (event.name === 'Writing') {
                progressState.runMode = 'Encoding';
                progressState.stage = 'Writing SOG chunks';
                progressState.detail = 'Preparing chunk files';
                progressState.activeIterationProgress = 1;
            } else if (typeof event.index === 'number' && typeof event.total === 'number' && isWritingScopeName(event.name)) {
                progressState.writingTotal = Math.max(progressState.writingTotal, event.total);
                progressState.currentWritingName = event.name;
                progressState.detail = `Writing chunk ${event.index} of ${event.total}: ${event.name}`;
            }
        } else if (event.kind === 'scopeEnd') {
            const currentName = progressState.activeScopeNames[event.depth];

            if (currentName === 'Decimate iteration') {
                progressState.decimateDone += 1;
                progressState.activeIterationProgress = 0;
                progressState.detail = `Completed ${progressState.decimateDone} of ${progressState.decimateExpected} decimate iterations`;
            } else if (currentName === 'Building KD-tree') {
                progressState.activeIterationProgress = Math.max(progressState.activeIterationProgress, 0.08);
            } else if (isWritingScopeName(currentName)) {
                progressState.writingDone += 1;
                progressState.writingProgress = 0;
                progressState.detail = progressState.writingDone < progressState.writingTotal ?
                    `Completed ${progressState.writingDone} of ${progressState.writingTotal} chunks` :
                    'Finalizing bundle';
            }

            progressState.activeScopeNames.length = event.depth;
        } else if (event.kind === 'barStart') {
            const insideDecimate = progressState.activeScopeNames.includes('Decimate iteration');
            const insideWriting = progressState.activeScopeNames.some(isWritingScopeName);

            if (insideDecimate) {
                progressState.stage = 'Generating LODs';
                progressState.detail = `${event.name} 0%`;
            } else if (insideWriting) {
                progressState.stage = 'Writing SOG chunks';
                progressState.detail = progressState.currentWritingName ?
                    `${progressState.currentWritingName}: ${event.name}` :
                    event.name;
            }
        } else if (event.kind === 'barTick') {
            const fraction = event.total > 0 ? event.current / event.total : 1;
            const insideDecimate = progressState.activeScopeNames.includes('Decimate iteration');
            const insideWriting = progressState.activeScopeNames.some(isWritingScopeName);

            if (insideDecimate) {
                progressState.activeIterationProgress = Math.max(
                    progressState.activeIterationProgress,
                    getIterationBarProgress(event.name, fraction)
                );
                progressState.detail = `${event.name} ${Math.round(fraction * 100)}%`;
            } else if (insideWriting) {
                progressState.writingProgress = Math.max(progressState.writingProgress, clamp01(fraction));
                progressState.detail = progressState.currentWritingName ?
                    `${progressState.currentWritingName}: ${event.name} ${Math.round(fraction * 100)}%` :
                    `${event.name} ${Math.round(fraction * 100)}%`;
            }
        } else if (event.kind === 'barEnd') {
            const insideDecimate = progressState.activeScopeNames.includes('Decimate iteration');
            const insideWriting = progressState.activeScopeNames.some(isWritingScopeName);

            if (insideDecimate) {
                progressState.activeIterationProgress = Math.max(
                    progressState.activeIterationProgress,
                    getIterationBarProgress(event.name, 1)
                );
            } else if (insideWriting) {
                progressState.writingProgress = 1;
            }
        }

        recomputeProgress();
        refreshProgressClock();
    }
};

const isSparkPreviewableSource = (name) => /\.(ply|splat|ksplat|spz|sog)$/i.test(name);
const isBundleZipFile = (name) => /\.zip$/i.test(name);
const isPlayCanvasPreviewableSource = (name) => /\.(ply|sog)$/i.test(name);

const slugifyStem = (name) => {
    const normalized = name.replaceAll("\\", "/").split("/").pop() || name;
    const withoutExtension = normalized
        .replace(/\.compressed\.ply$/i, '')
        .replace(/\.voxel\.json$/i, '')
        .replace(/\.[^.]+$/i, '');
    const slug = withoutExtension
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'output';
};

const getWriteOptions = () => ({
    iterations: Math.max(1, Number(iterationsInput.value) || 10),
    lodSelect: [],
    unbundled: false,
    lodChunkCount: Math.max(1, Number(chunkCountInput.value) || 512),
    lodChunkExtent: Math.max(1, Number(chunkExtentInput.value) || 16),
    lodGenerateRatios: parseRatios(),
    lodPreDecimateCount: parsePreDecimateCount() ?? undefined,
    spzVersion: Number(spzVersionSelect.value) === 3 ? 3 : 4
});

const getSelectedOutputTarget = () => outputTargetMap.get(outputFormatSelect.value) ?? outputTargets[0];

const syncTestState = () => {
    testState.sourceName = state.sourceName;
    testState.sourceRows = state.sourceRows;
    testState.outputFiles = state.files.length;
    testState.outputBytes = state.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    testState.outputLabel = outputValue.textContent;
    testState.archiveBytes = state.archiveBytes?.byteLength ?? 0;
    testState.progressPercent = progressState.percent;
    testState.progressElapsedMs = progressState.elapsedMs;
    testState.progressRemainingMs = progressState.remainingMs;
    testState.progressStage = progressState.stage;
    testState.progressDetail = progressState.detail;
    testState.progressMode = progressState.runMode;
    Object.assign(testState, sparkPreview.getState());
    Object.assign(testState, {
        playcanvasLoaded: playcanvasPreview.getState().loaded,
        playcanvasBundlePath: playcanvasPreview.getState().bundlePath,
        playcanvasError: playcanvasPreview.getState().error
    });
};

const appendLog = (chunk) => {
    logEl.textContent += chunk;
    logEl.scrollTop = logEl.scrollHeight;
};

const clearLog = () => {
    logEl.textContent = '';
};

const setState = (value) => {
    stateValue.textContent = value;
    testState.state = value;
    syncTestState();
};

const formatBytes = (bytes) => {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const normalizeArchiveName = (name) => {
    const normalized = name.replaceAll("\\", "/");
    const parts = normalized.split("/").filter(Boolean);
    const browserIndex = parts.lastIndexOf("browser-output");
    if (browserIndex >= 0) {
        return parts.slice(browserIndex).join("/");
    }
    const outputIndex = parts.lastIndexOf("output");
    if (outputIndex >= 0) {
        return parts.slice(outputIndex).join("/");
    }
    return parts.slice(-2).join("/") || "output.bin";
};

const buildArchive = (files) => {
    const archiveEntries = Object.fromEntries(
        files.map(({ name, bytes }) => [normalizeArchiveName(name), bytes])
    );
    return zipSync(archiveEntries, { level: 0 });
};

const renderFiles = () => {
    filesList.replaceChildren();

    if (state.files.length === 0) {
        const item = document.createElement('li');
        item.textContent = 'No files generated yet.';
        filesList.appendChild(item);
        outputValue.textContent = '-';
        filesSummary.textContent = 'No files generated yet.';
        zipButton.disabled = true;
        state.archiveBytes = null;
        syncTestState();
        return;
    }

    let totalBytes = 0;

    state.files.forEach(({ name, bytes }) => {
        totalBytes += bytes.byteLength;

        const item = document.createElement('li');
        const meta = document.createElement('div');
        meta.className = 'fileMeta';

        const fileName = document.createElement('span');
        fileName.className = 'fileName';
        fileName.textContent = name;

        const fileSize = document.createElement('span');
        fileSize.className = 'fileSize';
        fileSize.textContent = formatBytes(bytes.byteLength);

        meta.append(fileName, fileSize);

        const link = document.createElement('a');
        link.className = 'download';
        link.textContent = 'Download';
        link.href = URL.createObjectURL(new Blob([bytes]));
        link.download = name.split('/').pop() || name;

        item.append(meta, link);
        filesList.appendChild(item);
    });

    const archiveSummary = state.archiveBytes ? ` / zip ${formatBytes(state.archiveBytes.byteLength)}` : '';
    outputValue.textContent = `${state.files.length} files / ${formatBytes(totalBytes)}${archiveSummary}`;
    filesSummary.textContent = `${state.files.length} files, ${formatBytes(totalBytes)} total${archiveSummary}`;
    zipButton.disabled = false;
    syncTestState();
};

const applyBundleFiles = async (files, archiveName = state.archiveName) => {
    state.files = files.map(({ name, bytes }) => ({ name, bytes }));
    state.archiveName = archiveName;
    state.archiveBytes = buildArchive(state.files);
    renderFiles();
    await Promise.all([
        sparkPreview.loadBundleZip(state.archiveBytes, archiveName),
        playcanvasPreview.loadBundleFiles(state.files)
    ]);
};

const updateSourceSummary = () => {
    sourceValue.textContent = state.sourceName || 'None';
    rowsValue.textContent = state.sourceRows === null ? '-' : state.sourceRows.toLocaleString();
    syncTestState();
};

const loadPlainPreview = async (bytes, name) => {
    const previewNotes = [];

    try {
        await sparkPreview.loadSourceBytes(bytes, name);
    } catch (error) {
        const message = `Spark preview unavailable for ${name}: ${error instanceof Error ? error.message : String(error)}`;
        sparkPreview.clear(message);
        previewNotes.push(message);
    }

    if (isPlayCanvasPreviewableSource(name)) {
        await playcanvasPreview.loadFileBytes(bytes, name);
    } else {
        playcanvasPreview.clear(`PlayCanvas preview is not available for ${name} in this demo.`);
    }

    if (previewNotes.length > 0) {
        appendLog(`${previewNotes.join('\n')}\n`);
    }
};

const loadSamplePreview = async () => {
    const result = await callWorker('convert-source', {
        source: {
            kind: 'sample',
            name: state.sourceDescriptor.name
        },
        outputFilename: 'browser-output/generated-grid-sample.ply',
        outputFormat: 'ply',
        options: getWriteOptions()
    });

    const previewFile = result.files.find(({ name }) => /\.ply$/i.test(name));
    if (!previewFile) {
        throw new Error('Sample preview did not produce a previewable PLY file.');
    }

    await loadPlainPreview(previewFile.bytes, previewFile.name);
};

const parseRatios = () => {
    return normalizeLodRatios(ratiosInput.value
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 1));
};

const parsePreDecimateCount = () => {
    const raw = preDecimateInput.value.trim();
    if (!raw) {
        return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error('Pre-decimate target must be a non-negative number.');
    }
    const normalized = Math.round(value);
    return normalized > 0 ? normalized : null;
};

const populateOutputFormats = () => {
    outputFormatSelect.replaceChildren();
    const sampleStem = 'scene';

    for (const target of outputTargets) {
        try {
            const filename = target.buildFilename(sampleStem);
            const outputFormat = getOutputFormat(filename, {
                iterations: 10,
                lodSelect: [],
                unbundled: false,
                lodChunkCount: 512,
                lodChunkExtent: 16
            });
            if (outputFormat !== target.key) {
                continue;
            }

            const option = document.createElement('option');
            option.value = target.key;
            option.textContent = target.label;
            outputFormatSelect.appendChild(option);
        } catch {
            // Skip formats the current browser build does not expose.
        }
    }

    if (outputFormatSelect.options.length > 0) {
        const hasSpzOption = [...outputFormatSelect.options].some((option) => option.value === 'spz');
        if (hasSpzOption) {
            outputFormatSelect.value = 'spz';
        } else {
            outputFormatSelect.selectedIndex = 0;
        }
    }
};

const updateConversionUi = () => {
    const target = getSelectedOutputTarget();
    const noSource = !state.sourceDescriptor;
    const sourceIsBundle = state.sourceDescriptor?.kind === 'bundleZip';
    const previewText = target.supportText;
    formatOptionsList.replaceChildren();
    for (const optionLabel of target.optionLabels ?? []) {
        const item = document.createElement('li');
        item.textContent = optionLabel;
        formatOptionsList.appendChild(item);
    }

    formatIdentityValue.textContent = target.family ?? 'Output format';
    spzVersionLabel.hidden = target.key !== 'spz';
    spzVersionSelect.disabled = target.key !== 'spz';
    convertButton.disabled = noSource || sourceIsBundle;
    conversionHint.textContent = sourceIsBundle ?
        'Loaded bundles are already packaged; choose a plain source file to convert it into another format.' :
        previewText;
};

const callWorker = (type, payload, transfer = []) => {
    const requestId = nextRequestId++;
    return new Promise((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject });
        worker.postMessage({ type, requestId, ...payload }, transfer);
    });
};

worker.addEventListener('message', ({ data }) => {
    if (data.type === 'log-chunk') {
        appendLog(data.chunk);
        return;
    }

    if (data.type === 'log-event') {
        progressTracker.handle(data.event);
        return;
    }

    if (data.type === 'source-inspected') {
        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
            return;
        }
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
        return;
    }

    if (data.type === 'generation-complete') {
        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
            return;
        }
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
        return;
    }

    if (data.type === 'conversion-complete') {
        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
            return;
        }
        pendingRequests.delete(data.requestId);
        pending.resolve(data);
        return;
    }

    if (data.type === 'request-error') {
        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
            return;
        }
        pendingRequests.delete(data.requestId);
        pending.reject(new Error(data.message));
    }
});

worker.addEventListener('error', (event) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Worker failure');
    pendingRequests.forEach(({ reject }) => reject(error));
    pendingRequests.clear();
    failProgressRun(error.message);
    setState('Error');
});

const inspectCurrentSource = async () => {
    if (!state.sourceDescriptor) {
        throw new Error('Pick a source first.');
    }

    if (state.sourceDescriptor.kind === 'bundleZip') {
        return {
            sourceName: state.sourceDescriptor.name,
            sourceRows: null
        };
    }

    if (state.sourceDescriptor.kind === 'sample') {
        return await callWorker('inspect-source', {
            source: {
                kind: 'sample',
                name: state.sourceDescriptor.name
            }
        });
    }

    const bytes = new Uint8Array(await state.sourceDescriptor.file.arrayBuffer());
    return await callWorker('inspect-source', {
        source: {
            kind: 'file',
            name: state.sourceDescriptor.name,
            bytes
        }
    }, [bytes.buffer]);
};

const setSourceDescriptor = async () => {
    clearLog();
    sparkPreview.clear();
    playcanvasPreview.clear();
    if (state.sourceDescriptor?.kind !== 'bundleZip') {
        state.archiveName = "splat-transform-lod.zip";
    }
    beginProgressRun({
        runMode: 'Loading',
        stage: 'Loading Source',
        detail: `Opening ${state.sourceDescriptor.name}`,
        decimateExpected: 0
    });
    setState('Loading');

    const inspected = await inspectCurrentSource();
    state.sourceName = inspected.sourceName;
    state.sourceRows = inspected.sourceRows;
    updateSourceSummary();
    if (state.sourceDescriptor.kind === 'bundleZip') {
        const bytes = new Uint8Array(await state.sourceDescriptor.file.arrayBuffer());
        const entries = unzipSync(bytes);
        const files = Object.entries(entries).map(([name, fileBytes]) => ({
            name,
            bytes: fileBytes
        }));
        await applyBundleFiles(files, state.sourceDescriptor.name);
        appendLog(`Loaded bundle ${inspected.sourceName} (${files.length} files)\n`);
        setState('Ready');
        finishProgressRun(`Loaded bundle ${inspected.sourceName}`);
        updateConversionUi();
        return;
    }

    if (state.sourceDescriptor.kind === 'sample') {
        await loadSamplePreview();
    } else if (isSparkPreviewableSource(state.sourceDescriptor.name)) {
        const previewBytes = new Uint8Array(await state.sourceDescriptor.file.arrayBuffer());
        await loadPlainPreview(previewBytes, state.sourceDescriptor.name);
    }
    appendLog(`Loaded ${inspected.sourceName} (${inspected.sourceRows?.toLocaleString?.() ?? '-'} rows)\n`);
    setState('Ready');
    finishProgressRun(`Loaded ${inspected.sourceName} (${inspected.sourceRows?.toLocaleString?.() ?? '-'} rows)`);
    updateConversionUi();
};

const previewConversionResult = async (target, files, archiveName) => {
    if (target.preview === 'bundle') {
        await applyBundleFiles(files, archiveName);
        return;
    }

    state.files = files.map(({ name, bytes }) => ({ name, bytes }));
    state.archiveName = archiveName;
    state.archiveBytes = buildArchive(state.files);
    renderFiles();

    if (target.preview === 'plain' && files.length === 1) {
        await loadPlainPreview(files[0].bytes, files[0].name);
        return;
    }

    if (target.preview === 'asset-files' && target.previewEntry) {
        sparkPreview.clear();
        await playcanvasPreview.loadAssetFiles(files, target.previewEntry);
        return;
    }

    sparkPreview.clear();
    playcanvasPreview.clear();
    appendLog(`Preview unavailable for ${target.label}; download from Output Files below.\n`);
};

const convertCurrentSource = async () => {
    if (!state.sourceDescriptor) {
        throw new Error('Pick a source first.');
    }
    if (state.sourceDescriptor.kind === 'bundleZip') {
        throw new Error('Loaded bundles can be previewed directly but cannot be converted.');
    }

    clearLog();
    state.files = [];
    state.archiveBytes = null;
    renderFiles();

    const target = getSelectedOutputTarget();
    const writeOptions = getWriteOptions();
    const stem = slugifyStem(state.sourceDescriptor.name);
    const outputFilename = target.buildFilename(stem);
    const outputFormat = getOutputFormat(outputFilename, writeOptions);
    const generatingLod = outputFormat === 'lod';

    setState(generatingLod ? 'Generating' : 'Converting');
    beginProgressRun({
        runMode: generatingLod ? 'Generating' : 'Converting',
        stage: generatingLod ? 'Preparing' : 'Converting',
        detail: generatingLod ? 'Preparing LOD conversion job' : `Preparing ${target.label} conversion`,
        decimateExpected: generatingLod ? estimateLodDecimateIterations(state.sourceRows ?? 0, writeOptions.lodGenerateRatios ?? [], writeOptions.lodPreDecimateCount ?? null) : 0
    });

    let source;
    let transfer = [];
    if (state.sourceDescriptor.kind === 'sample') {
        source = {
            kind: 'sample',
            name: state.sourceDescriptor.name
        };
    } else {
        const bytes = new Uint8Array(await state.sourceDescriptor.file.arrayBuffer());
        source = {
            kind: 'file',
            name: state.sourceDescriptor.name,
            bytes
        };
        transfer = [bytes.buffer];
    }

    const result = await callWorker('convert-source', {
        source,
        outputFilename,
        outputFormat,
        options: writeOptions
    }, transfer);

    state.sourceName = result.sourceName;
    state.sourceRows = result.sourceRows;
    updateSourceSummary();

    const archiveName = `${slugifyStem(result.sourceName)}-${target.key}.zip`;
    await previewConversionResult(target, result.files, archiveName);
    setState('Done');
    finishProgressRun(
        generatingLod ?
            `Generated ${result.files.length} files from ${result.workingRows?.toLocaleString?.() ?? result.sourceRows?.toLocaleString?.() ?? '-'} working rows` :
            `Converted ${result.sourceName} to ${target.label}`
    );
};

const loadSourceFile = async (file) => {
    runButton.disabled = true;
    convertButton.disabled = true;
    sampleButton.disabled = true;
    state.sourceDescriptor = {
        kind: isBundleZipFile(file.name) ? 'bundleZip' : 'file',
        name: file.name,
        file
    };

    try {
        await setSourceDescriptor(state.sourceDescriptor);
    } catch (error) {
        clearLog();
        appendLog(`${error instanceof Error ? error.message : String(error)}\n`);
        setState('Error');
        failProgressRun(error instanceof Error ? error.message : String(error));
    } finally {
        fileInput.value = '';
        runButton.disabled = false;
        sampleButton.disabled = false;
        updateConversionUi();
    }
};

const run = async () => {
    if (!state.sourceDescriptor) {
        throw new Error('Pick a source first.');
    }
    if (state.sourceDescriptor.kind === 'bundleZip') {
        throw new Error('Loaded bundles can be previewed directly but cannot be regenerated.');
    }

    clearLog();
    state.files = [];
    state.archiveBytes = null;
    renderFiles();
    setState('Generating');

    const writeOptions = getWriteOptions();
    const ratios = writeOptions.lodGenerateRatios ?? [];
    const preDecimateCount = writeOptions.lodPreDecimateCount ?? null;
    beginProgressRun({
        runMode: 'Generating',
        stage: 'Preparing',
        detail: 'Preparing worker job',
        decimateExpected: estimateLodDecimateIterations(state.sourceRows ?? 0, ratios, preDecimateCount)
    });

    let source;
    let transfer = [];

    if (state.sourceDescriptor.kind === 'sample') {
        source = {
            kind: 'sample',
            name: state.sourceDescriptor.name
        };
    } else {
        const bytes = new Uint8Array(await state.sourceDescriptor.file.arrayBuffer());
        source = {
            kind: 'file',
            name: state.sourceDescriptor.name,
            bytes
        };
        transfer = [bytes.buffer];
    }

    const result = await callWorker('generate-lod-bundle', {
        source,
        ratios,
        iterations: writeOptions.iterations,
        chunkCount: writeOptions.lodChunkCount,
        chunkExtent: writeOptions.lodChunkExtent,
        preDecimateCount
    }, transfer);

    state.sourceName = result.sourceName;
    state.sourceRows = result.sourceRows;
    updateSourceSummary();
    await applyBundleFiles(result.files, state.archiveName);
    setState('Done');
    finishProgressRun(`Generated ${state.files.length} files from ${result.workingRows.toLocaleString()} working rows`);
};

sampleButton.addEventListener('click', async () => {
    runButton.disabled = true;
    convertButton.disabled = true;
    sampleButton.disabled = true;
    state.sourceDescriptor = {
        kind: 'sample',
        name: 'Generated grid sample'
    };

    try {
        await setSourceDescriptor(state.sourceDescriptor);
    } catch (error) {
        clearLog();
        appendLog(`${error instanceof Error ? error.message : String(error)}\n`);
        setState('Error');
        failProgressRun(error instanceof Error ? error.message : String(error));
    } finally {
        runButton.disabled = false;
        sampleButton.disabled = false;
        updateConversionUi();
    }
});

fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }
    await loadSourceFile(file);
});

runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    convertButton.disabled = true;
    sampleButton.disabled = true;

    try {
        await run();
    } catch (error) {
        appendLog(`${error instanceof Error ? error.message : String(error)}\n`);
        setState('Error');
        failProgressRun(error instanceof Error ? error.message : String(error));
    } finally {
        runButton.disabled = false;
        sampleButton.disabled = false;
        updateConversionUi();
    }
});

convertButton.addEventListener('click', async () => {
    runButton.disabled = true;
    convertButton.disabled = true;
    sampleButton.disabled = true;

    try {
        await convertCurrentSource();
    } catch (error) {
        appendLog(`${error instanceof Error ? error.message : String(error)}\n`);
        setState('Error');
        failProgressRun(error instanceof Error ? error.message : String(error));
    } finally {
        runButton.disabled = false;
        sampleButton.disabled = false;
        updateConversionUi();
    }
});

outputFormatSelect.addEventListener('change', updateConversionUi);
spzVersionSelect.addEventListener('change', updateConversionUi);

const setDropActive = (active) => {
    viewerDropZone.classList.toggle('isActive', active);
};

for (const eventName of ['dragenter', 'dragover']) {
    viewerDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        setDropActive(true);
    });
}

for (const eventName of ['dragleave', 'dragend']) {
    viewerDropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        if (event.target === viewerDropZone) {
            setDropActive(false);
        }
    });
}

viewerDropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    setDropActive(false);
    const [file] = [...(event.dataTransfer?.files ?? [])];
    if (!file) {
        return;
    }
    await loadSourceFile(file);
});

viewerDropZone.addEventListener('click', () => fileInput.click());
viewerDropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
    }
});

renderFiles();
updateSourceSummary();
resetProgress();
populateOutputFormats();
updateConversionUi();
appendLog(`Loaded browser build v${version}\n`);

zipButton.addEventListener("click", () => {
    if (!state.archiveBytes) {
        return;
    }

    const blob = new Blob([state.archiveBytes], { type: "application/zip" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = state.archiveName;
    testState.zipDownloads += 1;
    testState.lastArchiveName = link.download;
    link.click();
    URL.revokeObjectURL(href);
});
