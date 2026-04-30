import * as THREE from "three";
import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { createLodBundleRuntime, inspectZipBundle } from "./spark-splat-bundle.mjs";

const formatStats = (stats) => {
    const summary = stats.levelSummary ? `\n${stats.levelSummary}` : "";
    return `${stats.visibleLeaves}/${stats.totalLeaves} visible leaves\n` +
        `${stats.activeFiles} active files\n` +
        `${stats.activeSplats.toLocaleString()} splats${summary}`;
};

const frameObject = (camera, controls, object) => {
    const box = new THREE.Box3().setFromObject(object);
    if (!Number.isFinite(box.min.x) || box.isEmpty()) {
        return;
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.5, 0.5);
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    camera.position.copy(center.clone().add(new THREE.Vector3(0, 0, distance * 1.3)));
    camera.near = Math.max(distance / 500, 0.01);
    camera.far = Math.max(distance * 10, 100);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    if (controls.target) {
        controls.target.copy(center);
    }
};

const resizeRendererToCanvas = (renderer, camera, canvas, runtime) => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) {
        return;
    }
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }
    runtime?.setViewportHeight(height);
};

const createSparkPreview = ({
    canvas,
    lodModeSelect,
    lodDebugCheckbox,
    lodBaseDistanceInput,
    lodMultiplierInput,
    statsEl,
    errorEl,
    emptyEl,
    onStateChange
}) => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f16);

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false
    });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

    const camera = new THREE.PerspectiveCamera(75, 1, 0.01, 1000);
    camera.position.set(0, 0, 1.5);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const controls = new SparkControls({ canvas });

    let originalMesh = null;
    let activeRuntime = null;
    let disposed = false;
    let frameId = 0;

    const state = {
        loaded: false,
        bundleKind: null,
        mode: null,
        debugColorLods: false,
        lodBaseDistance: null,
        lodMultiplier: null,
        stats: null,
        activeMeshSplats: [],
        runtimeQuaternion: null,
        renderQuaternion: null,
        objectQuaternion: null,
        error: null
    };

    const syncState = () => {
        onStateChange?.({ ...state });
    };

    const rebuildModeOptions = () => {
        lodModeSelect.replaceChildren();

        if (originalMesh) {
            const option = document.createElement("option");
            option.value = "original";
            option.textContent = "Original";
            lodModeSelect.appendChild(option);
        }

        if (activeRuntime) {
            const autoOption = document.createElement("option");
            autoOption.value = "auto";
            autoOption.textContent = "Auto";
            lodModeSelect.appendChild(autoOption);
            activeRuntime.bundle.levels.forEach((lodLevel) => {
                const option = document.createElement("option");
                option.value = String(lodLevel);
                option.textContent = `LOD ${lodLevel}`;
                lodModeSelect.appendChild(option);
            });
        }
    };

    const applyVisibleMode = async () => {
        if (originalMesh) {
            originalMesh.visible = state.mode === "original";
        }

        if (activeRuntime) {
            const runtimeVisible = state.mode !== "original";
            activeRuntime.group.visible = runtimeVisible;
            if (runtimeVisible) {
                activeRuntime.setMode(state.mode ?? "auto");
                await activeRuntime.update(camera, { force: true });
            }
        }
    };

    const setError = (message) => {
        state.error = message;
        errorEl.textContent = message || "";
        errorEl.hidden = !message;
        syncState();
    };

    const updateControls = () => {
        const hasPreview = !!(originalMesh || activeRuntime);
        lodModeSelect.disabled = !hasPreview || lodModeSelect.options.length === 0;
        lodDebugCheckbox.disabled = !activeRuntime || state.mode === "original";
        lodDebugCheckbox.checked = !!activeRuntime?.debugColorLods;
        lodBaseDistanceInput.disabled = !activeRuntime || state.mode === "original";
        lodMultiplierInput.disabled = !activeRuntime || state.mode === "original";
        lodBaseDistanceInput.value = activeRuntime ? String(activeRuntime.lodBaseDistance) : "5";
        lodMultiplierInput.value = activeRuntime ? String(activeRuntime.lodMultiplier) : "3";
        emptyEl.hidden = true;

        const showingRuntime = !!activeRuntime && state.mode !== "original";
        statsEl.textContent = showingRuntime ? formatStats(activeRuntime.stats) : "";
        state.stats = showingRuntime ? activeRuntime.stats : null;
        state.debugColorLods = !!activeRuntime?.debugColorLods;
        state.lodBaseDistance = activeRuntime?.lodBaseDistance ?? null;
        state.lodMultiplier = activeRuntime?.lodMultiplier ?? null;
        state.activeMeshSplats = showingRuntime && activeRuntime ? [...activeRuntime.activeMeshes.entries()]
            .filter(([key, record]) => !record.persistent && record.mesh?.packedSplats)
            .map(([key, record]) => ({
                key,
                level: record.level ?? null,
                numSplats: record.mesh.packedSplats.numSplats
            })) : [];
        state.runtimeQuaternion = activeRuntime ? activeRuntime.group.quaternion.toArray() : null;
        state.renderQuaternion = activeRuntime ? activeRuntime.renderGroup.quaternion.toArray() : null;
        state.objectQuaternion = originalMesh ? originalMesh.quaternion.toArray() : null;
        syncState();
    };

    const disposeRuntime = () => {
        if (!activeRuntime) {
            return;
        }
        scene.remove(activeRuntime.group);
        activeRuntime.dispose();
        activeRuntime = null;
        state.runtimeQuaternion = null;
        state.renderQuaternion = null;
        state.debugColorLods = false;
        state.lodBaseDistance = null;
        state.lodMultiplier = null;
    };

    const disposeOriginalMesh = () => {
        if (!originalMesh) {
            return;
        }
        scene.remove(originalMesh);
        originalMesh.traverse?.((child) => {
            if (child !== originalMesh) {
                child.dispose?.();
            }
        });
        originalMesh.dispose?.();
        originalMesh = null;
        state.objectQuaternion = null;
    };

    const animate = async () => {
        if (disposed) {
            return;
        }
        resizeRendererToCanvas(renderer, camera, canvas, activeRuntime);
        controls.update(camera);
        if (activeRuntime && state.mode !== "original") {
            await activeRuntime.update(camera);
        }
        renderer.render(scene, camera);
        updateControls();
        frameId = globalThis.requestAnimationFrame(animate);
    };

    lodModeSelect.addEventListener("change", async () => {
        if (!originalMesh && !activeRuntime) {
            return;
        }
        state.mode = lodModeSelect.value;
        await applyVisibleMode();
        updateControls();
    });

    lodDebugCheckbox.addEventListener("change", async () => {
        if (!activeRuntime) {
            return;
        }
        activeRuntime.setDebugColorLods(lodDebugCheckbox.checked);
        await activeRuntime.update(camera, { force: true });
        updateControls();
    });

    lodBaseDistanceInput.addEventListener("change", async () => {
        if (!activeRuntime) {
            return;
        }
        activeRuntime.setLodBaseDistance(Number(lodBaseDistanceInput.value));
        await activeRuntime.update(camera, { force: true });
        updateControls();
    });

    lodMultiplierInput.addEventListener("change", async () => {
        if (!activeRuntime) {
            return;
        }
        activeRuntime.setLodMultiplier(Number(lodMultiplierInput.value));
        await activeRuntime.update(camera, { force: true });
        updateControls();
    });

    const loadSourceBytes = async (bytes, name) => {
        setError(null);
        disposeOriginalMesh();

        const splat = new SplatMesh({
            fileBytes: bytes.slice(),
            fileName: name
        });
        await splat.initialized;
        splat.quaternion.set(0, 0, 0, 1);
        originalMesh = splat;
        state.objectQuaternion = splat.quaternion.toArray();
        state.runtimeQuaternion = null;
        state.renderQuaternion = null;
        state.debugColorLods = false;
        state.lodBaseDistance = null;
        state.lodMultiplier = null;
        scene.add(splat);

        state.loaded = true;
        state.bundleKind = activeRuntime ? activeRuntime.bundle.kind : "plain";
        state.mode = "original";
        state.error = null;
        state.name = name;
        rebuildModeOptions();
        lodModeSelect.value = "original";
        await applyVisibleMode();
        frameObject(camera, controls, splat);
        syncState();
        updateControls();
    };

    const loadBundleZip = async (bytes, name = "splat-transform-lod.zip") => {
        setError(null);
        disposeRuntime();

        const bundle = inspectZipBundle(bytes);
        const runtime = await createLodBundleRuntime(bundle);
        activeRuntime = runtime;
        state.runtimeQuaternion = runtime.group.quaternion.toArray();
        state.renderQuaternion = runtime.renderGroup.quaternion.toArray();
        state.debugColorLods = runtime.debugColorLods;
        state.lodBaseDistance = runtime.lodBaseDistance;
        state.lodMultiplier = runtime.lodMultiplier;
        state.objectQuaternion = originalMesh ? originalMesh.quaternion.toArray() : null;
        scene.add(runtime.group);
        rebuildModeOptions();
        state.mode = "auto";
        lodModeSelect.value = state.mode;
        await applyVisibleMode();
        frameObject(camera, controls, runtime.group);

        state.loaded = true;
        state.bundleKind = bundle.kind;
        state.stats = state.mode === "original" ? null : runtime.stats;
        state.activeMeshSplats = [];
        state.error = null;
        state.name = name;
        syncState();
        updateControls();
    };

    const clear = () => {
        disposeOriginalMesh();
        disposeRuntime();
        setError(null);
        state.loaded = false;
        state.bundleKind = null;
        state.mode = null;
        state.debugColorLods = false;
        state.lodBaseDistance = null;
        state.lodMultiplier = null;
        state.stats = null;
        state.activeMeshSplats = [];
        updateControls();
    };

    const dispose = () => {
        disposed = true;
        globalThis.cancelAnimationFrame(frameId);
        disposeOriginalMesh();
        disposeRuntime();
        renderer.dispose();
    };

    updateControls();
    frameId = globalThis.requestAnimationFrame(animate);

    return {
        loadSourceBytes,
        loadBundleZip,
        clear,
        dispose,
        getState: () => ({ ...state })
    };
};

export { createSparkPreview };
