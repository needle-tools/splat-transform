import * as THREE from "three";
import { strFromU8, unzipSync } from "fflate";
import { chooseAutoLodLevel, pickLevel } from "./lod-selection.mjs";

import {
  PackedSplats,
  SplatFileType,
  SplatMesh,
  unpackSplats,
} from "@sparkjsdev/spark";

const normalizePath = (value) =>
  value
    .replaceAll("\\", "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");

const dirname = (value) => {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index + 1);
};

const basename = (value) => {
  const normalized = normalizePath(value);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? normalized : normalized.slice(index + 1);
};

const toArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const listJsonFiles = (json) => {
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

const isSogMeta = (json) => {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return false;
  }
  for (const key of ["means", "scales", "quats", "sh0"]) {
    if (!json[key] || typeof json[key] !== "object") {
      return false;
    }
    if (!Array.isArray(json[key].files)) {
      return false;
    }
  }
  return true;
};

const isLodBundleMeta = (json) =>
  !!(
    json &&
    typeof json === "object" &&
    !Array.isArray(json) &&
    Array.isArray(json.filenames) &&
    json.tree &&
    typeof json.lodLevels === "number"
  );

const resolveEntryName = (entries, reference, basePath = "") => {
  const entryNames = Object.keys(entries);
  const normalizedReference = normalizePath(reference);
  const normalizedBase = dirname(basePath);

  const directCandidates = [
    normalizedReference,
    normalizePath(normalizedBase + normalizedReference),
  ];

  for (const candidate of directCandidates) {
    const match = entryNames.find((name) => normalizePath(name) === candidate);
    if (match) {
      return match;
    }
  }

  const suffixes = [
    `/${normalizedReference}`,
    normalizedBase
      ? `/${normalizePath(normalizedBase + normalizedReference)}`
      : "",
  ].filter(Boolean);

  for (const suffix of suffixes) {
    const match = entryNames.find((name) =>
      normalizePath(name).endsWith(suffix),
    );
    if (match) {
      return match;
    }
  }

  throw new Error(`Missing bundle entry: ${reference}`);
};

const SPARK_TEXTURE_ROW_WIDTH = 2048;

const computePackedCapacity = (numSplats) => {
  if (numSplats <= 0) {
    return 0;
  }
  return Math.ceil(numSplats / SPARK_TEXTURE_ROW_WIDTH) * SPARK_TEXTURE_ROW_WIDTH;
};

const mergeRanges = (ranges) => {
  const sorted = ranges
    .map((range) => ({ offset: range.offset, count: range.count }))
    .sort((a, b) => a.offset - b.offset);

  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...range });
      continue;
    }

    const lastEnd = last.offset + last.count;
    const rangeEnd = range.offset + range.count;
    if (range.offset <= lastEnd) {
      last.count = Math.max(lastEnd, rangeEnd) - last.offset;
      continue;
    }

    merged.push({ ...range });
  }
  return merged;
};

const copyPackedRanges = (source, ranges, wordsPerSplat, capacity = null) => {
  const totalSplats = ranges.reduce((sum, range) => sum + range.count, 0);
  const allocatedSplats = capacity ?? totalSplats;
  const result = new Uint32Array(allocatedSplats * wordsPerSplat);
  let dest = 0;

  for (const { offset, count } of ranges) {
    const start = offset * wordsPerSplat;
    const end = start + count * wordsPerSplat;
    result.set(source.subarray(start, end), dest);
    dest += count * wordsPerSplat;
  }

  return result;
};

const collectLeafNodes = (node, leaves, path = "0") => {
  const children = Array.isArray(node?.children) ? node.children : null;
  if (children?.length) {
    children.forEach((child, index) =>
      collectLeafNodes(child, leaves, `${path}.${index}`),
    );
    return;
  }

  const lodEntries = Object.entries(node?.lods ?? {})
    .map(([level, value]) => ({
      level: Number(level),
      file: value.file,
      offset: value.offset,
      count: value.count,
    }))
    .sort((a, b) => a.level - b.level);

  if (lodEntries.length === 0) {
    return;
  }

  const box = new THREE.Box3(
    new THREE.Vector3(...node.bound.min),
    new THREE.Vector3(...node.bound.max),
  );

  leaves.push({
    id: path,
    box,
    size: box.getSize(new THREE.Vector3()).length(),
    levels: lodEntries.map(({ level }) => level),
    lodByLevel: new Map(lodEntries.map((entry) => [entry.level, entry])),
  });
};

const buildLevelChunks = (lodMeta) => {
  const levels = new Map();
  for (const filename of lodMeta.filenames) {
    const match = /^(\d+)_\d+\/meta\.json$/i.exec(filename);
    if (!match) {
      continue;
    }
    const level = Number(match[1]);
    const list = levels.get(level) ?? [];
    list.push(filename);
    levels.set(level, list);
  }
  return levels;
};

const makeStats = (bundle) => ({
  mode: "auto",
  visibleLeaves: 0,
  totalLeaves: bundle.leaves.length,
  activeFiles: 0,
  activeSplats: 0,
  levelSummary: "",
});

const LOD_DEBUG_COLORS = [
  new THREE.Color("#ff6b6b"),
  new THREE.Color("#4ecdc4"),
  new THREE.Color("#ffd166"),
  new THREE.Color("#7b61ff"),
  new THREE.Color("#8bd450"),
  new THREE.Color("#ff9f1c"),
];

const getLodDebugColor = (level) =>
  LOD_DEBUG_COLORS[
    ((level % LOD_DEBUG_COLORS.length) + LOD_DEBUG_COLORS.length) %
      LOD_DEBUG_COLORS.length
  ];

const isPerSplatKey = (key) => key === "sh1" || key === "sh2" || key === "sh3";
const isCodebookKey = (key) =>
  key === "sh1Codes" || key === "sh2Codes" || key === "sh3Codes";

const cloneExtraForRanges = (extra, numSplats, ranges, capacity) => {
  const next = {};

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (isPerSplatKey(key) && value instanceof Uint32Array) {
      const wordsPerSplat = value.length / Math.max(numSplats, 1);
      next[key] = copyPackedRanges(value, ranges, wordsPerSplat, capacity);
    } else if (isCodebookKey(key) && value instanceof Uint32Array) {
      next[key] = value.slice();
    }
  }

  return next;
};

export const unzipEntries = (fileBytes) => {
  const entries = unzipSync(fileBytes);
  return Object.fromEntries(
    Object.entries(entries).map(([name, bytes]) => [
      normalizePath(name),
      bytes,
    ]),
  );
};

export const inspectZipBundle = (fileBytes) => {
  const entries = unzipEntries(fileBytes);
  const entryNames = Object.keys(entries);

  const lodMetaEntry = entryNames.find(
    (name) => basename(name) === "lod-meta.json",
  );
  if (lodMetaEntry) {
    const lodMeta = JSON.parse(strFromU8(entries[lodMetaEntry]));
    if (!isLodBundleMeta(lodMeta)) {
      throw new Error(
        "Found lod-meta.json but it is not a recognized SplatTransform LOD bundle.",
      );
    }

    const leaves = [];
    collectLeafNodes(lodMeta.tree, leaves);

    return {
      kind: "lod-bundle",
      entries,
      metaEntry: lodMetaEntry,
      meta: lodMeta,
      levels: [...buildLevelChunks(lodMeta).keys()].sort((a, b) => a - b),
      chunkMetaByLevel: buildLevelChunks(lodMeta),
      leaves,
    };
  }

  const rootMetaEntry = entryNames.find(
    (name) => normalizePath(name) === "meta.json",
  );
  if (rootMetaEntry) {
    const sogMeta = JSON.parse(strFromU8(entries[rootMetaEntry]));
    if (isSogMeta(sogMeta)) {
      return {
        kind: "sog-bundle",
        entries,
        metaEntry: rootMetaEntry,
      };
    }
  }

  return {
    kind: "unknown",
    entries,
  };
};

const decodeSogEntry = async ({ entries, metaEntry }) => {
  const resolvedMetaEntry = resolveEntryName(entries, metaEntry);
  const metaBytes = entries[resolvedMetaEntry];
  const metaJson = JSON.parse(strFromU8(metaBytes));
  if (!isSogMeta(metaJson)) {
    throw new Error(`Entry is not a valid SOG meta.json: ${metaEntry}`);
  }

  const extraFiles = {};
  for (const filename of listJsonFiles(metaJson)) {
    const entryName = resolveEntryName(entries, filename, resolvedMetaEntry);
    extraFiles[filename] = toArrayBuffer(entries[entryName]);
  }

  return await unpackSplats({
    input: metaBytes,
    extraFiles,
    fileType: SplatFileType.PCSOGS,
    pathOrUrl: resolvedMetaEntry,
  });
};

export const createPackedSubset = ({ decoded, ranges }) => {
  const mergedRanges = mergeRanges(ranges);
  const numSplats = mergedRanges.reduce((sum, range) => sum + range.count, 0);
  const capacity = computePackedCapacity(numSplats);
  const packedArray = copyPackedRanges(decoded.packedArray, mergedRanges, 4, capacity);
  const extra = cloneExtraForRanges(
    decoded.extra,
    decoded.numSplats,
    mergedRanges,
    capacity,
  );

  return new PackedSplats({
    packedArray,
    numSplats,
    extra,
    splatEncoding: { ...decoded.splatEncoding },
  });
};

export const createPackedSplatsFromSogEntry = async ({
  entries,
  metaEntry,
}) => {
  const decoded = await decodeSogEntry({ entries, metaEntry });
  return new PackedSplats(decoded);
};

export const loadLodBundleLevel = async ({ bundle, level }) => {
  const entryNames = bundle.chunkMetaByLevel.get(level);
  if (!entryNames || entryNames.length === 0) {
    throw new Error(`No chunks found for LOD level ${level}.`);
  }

  const packedSplats = [];
  for (const metaEntry of entryNames) {
    packedSplats.push(
      await createPackedSplatsFromSogEntry({
        entries: bundle.entries,
        metaEntry,
      }),
    );
  }

  if (bundle.meta.environment) {
    packedSplats.unshift(
      await createPackedSplatsFromSogEntry({
        entries: bundle.entries,
        metaEntry: bundle.meta.environment,
      }),
    );
  }

  return packedSplats;
};

export class LodBundleRuntime {
  constructor(bundle) {
    this.bundle = bundle;
    this.group = new THREE.Group();
    this.renderGroup = new THREE.Group();
    this.renderGroup.quaternion.set(0, 0, 1, 0);
    this.group.add(this.renderGroup);

    this.decodeCache = new Map();
    this.activeMeshes = new Map();
    this.stats = makeStats(bundle);

    this.mode = "auto";
    this.debugColorLods = false;
    this.lodBias = 0;
    this.lodBaseDistance = 5;
    this.lodMultiplier = 3;
    this.updateIntervalMs = 150;
    this.viewportHeight = globalThis.window?.innerHeight ?? 1080;

    this.lastUpdateTime = 0;
    this.lastSelectionKey = "";
    this.selectionVersion = 0;

    this._box = new THREE.Box3();
    this._inverseWorld = new THREE.Matrix4();
    this._cameraLocal = new THREE.Vector3();
  }

  async initialize() {
    if (!this.bundle.meta.environment) {
      return;
    }

    const environmentSplats = await createPackedSplatsFromSogEntry({
      entries: this.bundle.entries,
      metaEntry: this.bundle.meta.environment,
    });
    const environmentMesh = new SplatMesh({ packedSplats: environmentSplats });
    environmentMesh.quaternion.set(0, 0, 0, 1);
    this.renderGroup.add(environmentMesh);
    this.activeMeshes.set("__environment__", {
      mesh: environmentMesh,
      persistent: true,
    });
  }

  dispose() {
    for (const { mesh } of this.activeMeshes.values()) {
      this.renderGroup.remove(mesh);
      mesh.dispose?.();
    }
    this.activeMeshes.clear();
  }

  setMode(mode) {
    this.mode = mode;
    this.stats.mode = mode;
    this.lastSelectionKey = "";
  }

  setDebugColorLods(enabled) {
    this.debugColorLods = !!enabled;
    this.lastSelectionKey = "";
  }

  setViewportHeight(height) {
    if (Number.isFinite(height) && height > 0) {
      this.viewportHeight = height;
    }
  }

  setLodBaseDistance(value) {
    if (Number.isFinite(value) && value > 0) {
      this.lodBaseDistance = value;
      this.lastSelectionKey = "";
    }
  }

  setLodMultiplier(value) {
    if (Number.isFinite(value) && value >= 1.2) {
      this.lodMultiplier = value;
      this.lastSelectionKey = "";
    }
  }

  getDecodedSog(metaEntry) {
    const resolvedMetaEntry = resolveEntryName(this.bundle.entries, metaEntry);
    if (!this.decodeCache.has(resolvedMetaEntry)) {
      this.decodeCache.set(
        resolvedMetaEntry,
        decodeSogEntry({
          entries: this.bundle.entries,
          metaEntry: resolvedMetaEntry,
        }),
      );
    }
    return this.decodeCache.get(resolvedMetaEntry);
  }

  chooseLevel(leaf, camera) {
    if (this.mode !== "auto") {
      return pickLevel(leaf.levels, Number(this.mode));
    }

    this._box.copy(leaf.box);
    const distance = Math.max(this._box.distanceToPoint(this._cameraLocal), 0);
    return chooseAutoLodLevel({
      availableLevels: leaf.levels,
      lodLevels: this.bundle.meta.lodLevels,
      distance,
      cameraFovDegrees: camera.fov,
      cameraAspect: camera.aspect,
      lodBaseDistance: this.lodBaseDistance,
      lodMultiplier: this.lodMultiplier,
      lodBias: this.lodBias,
    });
  }

  buildSelection(camera) {
    this.group.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    this._inverseWorld.copy(this.group.matrixWorld).invert();
    this._cameraLocal.copy(camera.position).applyMatrix4(this._inverseWorld);

    const buckets = new Map();
    const levelCounts = new Map();
    let visibleLeaves = 0;
    let activeSplats = 0;

    for (const leaf of this.bundle.leaves) {
      visibleLeaves += 1;
      const level = this.chooseLevel(leaf, camera);
      const lod = leaf.lodByLevel.get(level);
      if (!lod) {
        continue;
      }

      const metaEntry = this.bundle.meta.filenames[lod.file];
      const bucketKey = this.debugColorLods
        ? `${level}:${metaEntry}`
        : metaEntry;
      const bucket = buckets.get(bucketKey) ?? {
        metaEntry,
        level,
        ranges: [],
      };
      bucket.ranges.push({ offset: lod.offset, count: lod.count });
      buckets.set(bucketKey, bucket);

      activeSplats += lod.count;
      levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    }

    const resolvedBuckets = [...buckets.entries()]
      .map(([bucketId, bucket]) => {
        const mergedRanges = mergeRanges(bucket.ranges);
        const key = `${bucketId}:${mergedRanges.map((range) => `${range.offset}-${range.count}`).join(",")}`;
        return {
          metaEntry: bucket.metaEntry,
          level: bucket.level,
          ranges: mergedRanges,
          key,
        };
      })
      .sort((a, b) => a.metaEntry.localeCompare(b.metaEntry) || a.level - b.level);

    const selectionKey = resolvedBuckets.map((bucket) => bucket.key).join("|");
    const levelSummary = [...levelCounts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, count]) => `L${level}:${count}`)
      .join(" ");

    return {
      buckets: resolvedBuckets,
      selectionKey,
      stats: {
        mode: this.mode,
        visibleLeaves,
        totalLeaves: this.bundle.leaves.length,
        activeFiles: resolvedBuckets.length,
        activeSplats,
        levelSummary,
      },
    };
  }

  async update(camera, { force = false } = {}) {
    const now = performance.now();
    if (!force && now - this.lastUpdateTime < this.updateIntervalMs) {
      return;
    }
    this.lastUpdateTime = now;

    const selection = this.buildSelection(camera);
    this.stats = selection.stats;
    if (selection.selectionKey === this.lastSelectionKey) {
      return;
    }

    const version = ++this.selectionVersion;
    const desiredKeys = new Set(selection.buckets.map((bucket) => bucket.key));
    const meshesToAdd = [];

    for (const bucket of selection.buckets) {
      if (this.activeMeshes.has(bucket.key)) {
        continue;
      }

      const decoded = await this.getDecodedSog(bucket.metaEntry);
      if (version !== this.selectionVersion) {
        return;
      }

      const packedSplats = createPackedSubset({
        decoded,
        ranges: bucket.ranges,
      });
      const mesh = new SplatMesh({ packedSplats });
      mesh.quaternion.set(0, 0, 0, 1);
      if (this.debugColorLods) {
        mesh.recolor.copy(getLodDebugColor(bucket.level));
      }
      meshesToAdd.push({ key: bucket.key, mesh, level: bucket.level });
    }

    if (version !== this.selectionVersion) {
      for (const { mesh } of meshesToAdd) {
        mesh.dispose?.();
      }
      return;
    }

    for (const [key, record] of this.activeMeshes.entries()) {
      if (record.persistent || desiredKeys.has(key)) {
        continue;
      }
      this.renderGroup.remove(record.mesh);
      record.mesh.dispose?.();
      this.activeMeshes.delete(key);
    }

    for (const entry of meshesToAdd) {
      this.renderGroup.add(entry.mesh);
      this.activeMeshes.set(entry.key, entry);
    }

    this.lastSelectionKey = selection.selectionKey;
  }
}

export const createLodBundleRuntime = async (bundle) => {
  const runtime = new LodBundleRuntime(bundle);
  await runtime.initialize();
  return runtime;
};
