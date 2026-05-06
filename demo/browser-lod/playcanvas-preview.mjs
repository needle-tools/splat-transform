import { strFromU8, unzipSync } from "fflate";
import { css as viewerCss, html as viewerHtml, js as viewerJs } from "@playcanvas/supersplat-viewer";

const MESSAGE_SOURCE = "browser-lod-playcanvas-preview";

const defaultSettings = {
    version: 2,
    tonemapping: "none",
    highPrecisionRendering: false,
    background: { color: [0.04, 0.06, 0.09] },
    postEffectSettings: {
        sharpness: { enabled: false, amount: 0 },
        bloom: { enabled: false, intensity: 1, blurLevel: 2 },
        grading: { enabled: false, brightness: 0, contrast: 1, saturation: 1, tint: [1, 1, 1] },
        vignette: { enabled: false, intensity: 0.5, inner: 0.3, outer: 0.75, curvature: 1 },
        fringing: { enabled: false, intensity: 0.5 }
    },
    animTracks: [],
    cameras: [{
        initial: {
            position: [2, 2, -2],
            target: [0, 0, 0],
            fov: 75
        }
    }],
    annotations: [],
    startMode: "default"
};

const normalizePath = (name) =>
    name
        .replaceAll("\\", "/")
        .replace(/^\/+/, "")
        .replace(/^\.\/+/, "")
        .replace(/\/+/g, "/");

const dirname = (name) => {
    const normalized = normalizePath(name);
    const index = normalized.lastIndexOf("/");
    return index >= 0 ? normalized.slice(0, index + 1) : "";
};

const findLodMetaPath = (files) => {
    const match = files.find(({ name }) => normalizePath(name).split("/").pop() === "lod-meta.json");
    return match ? normalizePath(match.name) : null;
};

const guessMimeType = (name) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".json")) {
        return "application/json";
    }
    if (lower.endsWith(".png")) {
        return "image/png";
    }
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
        return "image/jpeg";
    }
    if (lower.endsWith(".webp")) {
        return "image/webp";
    }
    if (lower.endsWith(".wasm")) {
        return "application/wasm";
    }
    return "application/octet-stream";
};

const isSogMeta = (json) => {
    if (!json || typeof json !== "object" || Array.isArray(json)) {
        return false;
    }
    for (const key of ["means", "scales", "quats", "sh0"]) {
        if (!json[key] || typeof json[key] !== "object" || !Array.isArray(json[key].files)) {
            return false;
        }
    }
    return true;
};

const resolveRelativePath = (basePath, reference) => {
    const normalizedReference = normalizePath(reference);
    const normalizedBase = dirname(basePath);
    return normalizePath(normalizedBase + normalizedReference);
};

const listSogFiles = (json) => {
    const files = [];
    for (const key of ["means", "scales", "quats", "sh0"]) {
        const group = json?.[key];
        if (group?.files) {
            files.push(...group.files);
        }
    }
    if (json?.shN?.files) {
        files.push(...json.shN.files);
    }
    return files;
};

const buildSrcDoc = (contentUrl, contentName, virtualNameEntries, token) => {
    const reportScript = `
            const PREVIEW_TOKEN = ${JSON.stringify(token)};
            const MESSAGE_SOURCE = ${JSON.stringify(MESSAGE_SOURCE)};
            const VIRTUAL_NAME_MAP = ${JSON.stringify(Object.fromEntries(virtualNameEntries))};
            globalThis.__browserLodResolveVirtualUrl = (url) => VIRTUAL_NAME_MAP[url] ?? url;
            const report = (type, payload = {}) => {
                globalThis.parent?.postMessage({
                    source: MESSAGE_SOURCE,
                    token: PREVIEW_TOKEN,
                    type,
                    ...payload
                }, "*");
            };
            globalThis.addEventListener("error", (event) => {
                report("error", {
                    message: event.error instanceof Error ? event.error.message : String(event.message ?? "Unknown preview error")
                });
            });
            globalThis.addEventListener("unhandledrejection", (event) => {
                const reason = event.reason;
                report("error", {
                    message: reason instanceof Error ? reason.message : String(reason ?? "Unhandled preview rejection")
                });
            });
    `;

    return viewerHtml
        .replace('<link rel="stylesheet" href="./index.css">', `<style>\n${viewerCss}\n        </style>`)
        .replace('<script type="module">', `<script>\n${reportScript}\n        </script>\n        <script type="module">`)
        .replace("import { main } from './index.js';", viewerJs.replace(
            "const basename = path.getBasename(this._getUrlWithoutParams(url)).toLowerCase();",
            "const resolvedUrl = globalThis.__browserLodResolveVirtualUrl?.(url) ?? url;\n\t\t\t\tconst basename = path.getBasename(this._getUrlWithoutParams(resolvedUrl)).toLowerCase();",
        ))
        .replace("const settingsUrl = url.searchParams.has('settings') ? url.searchParams.get('settings') : './settings.json';", "const settingsUrl = null;")
        .replace("const contentUrl = url.searchParams.has('content') ? url.searchParams.get('content') : './scene.compressed.ply';", `const contentUrl = ${JSON.stringify(contentUrl)};`)
        .replace("const filename = new URL(contentUrl, location.href).pathname.split('/').pop();", `const filename = ${JSON.stringify(contentName)};`)
        .replace("noui: url.searchParams.has('noui'),", "noui: true,")
        .replace("nofx: url.searchParams.has('nofx'),", "nofx: true,")
        .replace("settings: fetch(settingsUrl).then(response => response.json())", `settings: Promise.resolve(${JSON.stringify(defaultSettings)})`)
        .replace("const viewer = await main(canvas, settingsJson, config);", `const viewer = await main(canvas, settingsJson, config);\n                report("loaded");\n                globalThis.__playcanvasViewer = viewer;`);
};

const createBlobBackedBundle = (files) => {
    const fileMap = new Map(files.map(({ name, bytes }) => [normalizePath(name), bytes]));
    const blobUrlByName = new Map();
    const virtualNameByUrl = new Map();
    const encoder = new TextEncoder();

    const makeBlobUrl = (bytes, mimeType) => URL.createObjectURL(new Blob([bytes], { type: mimeType }));

    const buildUrlForEntry = (entryName) => {
        const normalizedName = normalizePath(entryName);
        if (blobUrlByName.has(normalizedName)) {
            return blobUrlByName.get(normalizedName);
        }

        const bytes = fileMap.get(normalizedName);
        if (!bytes) {
            throw new Error(`Missing bundle entry: ${normalizedName}`);
        }

        const lowerName = normalizedName.toLowerCase();
        if (lowerName.endsWith(".json")) {
            const json = JSON.parse(strFromU8(bytes));

            if (lowerName.endsWith("/meta.json") && isSogMeta(json)) {
                for (const fileName of listSogFiles(json)) {
                    const resolved = resolveRelativePath(normalizedName, fileName);
                    const assetUrl = buildUrlForEntry(resolved);
                    const targetGroups = [];
                    for (const key of ["means", "scales", "quats", "sh0"]) {
                        if (Array.isArray(json[key]?.files)) {
                            targetGroups.push(json[key].files);
                        }
                    }
                    if (Array.isArray(json.shN?.files)) {
                        targetGroups.push(json.shN.files);
                    }
                    for (const group of targetGroups) {
                        for (let index = 0; index < group.length; index += 1) {
                            if (group[index] === fileName) {
                                group[index] = assetUrl;
                            }
                        }
                    }
                }

                const blobUrl = makeBlobUrl(encoder.encode(JSON.stringify(json)), "application/json");
                blobUrlByName.set(normalizedName, blobUrl);
                virtualNameByUrl.set(blobUrl, normalizedName);
                return blobUrl;
            }

            if (lowerName.endsWith("lod-meta.json") && Array.isArray(json.filenames)) {
                json.filenames = json.filenames.map((fileName) => buildUrlForEntry(resolveRelativePath(normalizedName, fileName)));
                if (typeof json.environment === "string" && json.environment.length > 0) {
                    json.environment = buildUrlForEntry(resolveRelativePath(normalizedName, json.environment));
                }

                const blobUrl = makeBlobUrl(encoder.encode(JSON.stringify(json)), "application/json");
                blobUrlByName.set(normalizedName, blobUrl);
                virtualNameByUrl.set(blobUrl, normalizedName);
                return blobUrl;
            }
        }

        const blobUrl = makeBlobUrl(bytes, guessMimeType(normalizedName));
        blobUrlByName.set(normalizedName, blobUrl);
        virtualNameByUrl.set(blobUrl, normalizedName);
        return blobUrl;
    };

    return {
        buildUrlForEntry,
        getVirtualNameEntries() {
            return [...virtualNameByUrl.entries()];
        },
        revokeAll() {
            for (const blobUrl of blobUrlByName.values()) {
                URL.revokeObjectURL(blobUrl);
            }
            blobUrlByName.clear();
            virtualNameByUrl.clear();
        }
    };
};

const createPlayCanvasPreview = ({
    iframe,
    statusEl,
    onStateChange
}) => {
    const state = {
        loaded: false,
        bundlePath: null,
        error: null
    };

    let activeToken = 0;
    let activeBundle = null;

    const syncState = () => {
        statusEl.textContent = state.error ? state.error : (state.loaded ? `Loaded ${state.bundlePath}` : "");
        onStateChange?.({ ...state });
    };

    const clearBundle = () => {
        activeBundle?.revokeAll();
        activeBundle = null;
    };

    const handleMessage = (event) => {
        if (event.source !== iframe.contentWindow) {
            return;
        }

        const data = event.data;
        if (!data || data.source !== MESSAGE_SOURCE || data.token !== activeToken) {
            return;
        }

        if (data.type === "loaded") {
            state.loaded = true;
            state.error = null;
            syncState();
            return;
        }

        if (data.type === "error") {
            state.loaded = false;
            state.error = data.message || "PlayCanvas preview failed.";
            syncState();
        }
    };

    globalThis.addEventListener("message", handleMessage);
    syncState();

    const loadContentFiles = async (files, entryName) => {
        clearBundle();
        activeBundle = createBlobBackedBundle(files);

        activeToken += 1;
        state.loaded = false;
        state.bundlePath = normalizePath(entryName);
        state.error = null;
        syncState();

        const contentUrl = activeBundle.buildUrlForEntry(entryName);
        const contentName = normalizePath(entryName).split("/").pop();
        iframe.srcdoc = buildSrcDoc(
            contentUrl,
            contentName,
            activeBundle.getVirtualNameEntries(),
            activeToken,
        );
    };

    return {
        async loadBundleFiles(files) {
            const bundlePath = findLodMetaPath(files);
            if (!bundlePath) {
                throw new Error("Could not find lod-meta.json in generated files.");
            }
            await loadContentFiles(files, bundlePath);
        },

        async loadBundleZip(bytes) {
            const entries = unzipSync(bytes);
            const files = Object.entries(entries).map(([name, fileBytes]) => ({
                name,
                bytes: fileBytes
            }));
            await this.loadBundleFiles(files);
        },

        async loadAssetFiles(files, entryName) {
            await loadContentFiles(files, entryName);
        },

        async loadFileBytes(bytes, name) {
            await loadContentFiles([{
                name,
                bytes
            }], name);
        },

        clear() {
            activeToken += 1;
            state.loaded = false;
            state.bundlePath = null;
            state.error = null;
            clearBundle();
            iframe.srcdoc = "";
            syncState();
        },

        dispose() {
            globalThis.removeEventListener("message", handleMessage);
            clearBundle();
            iframe.srcdoc = "";
        },

        getState() {
            return { ...state };
        }
    };
};

export { createPlayCanvasPreview };
