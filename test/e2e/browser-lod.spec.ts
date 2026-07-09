import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/splat",
);

test("browser demo generates a downloadable LOD zip", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/demo/browser-lod/");

  await page.getByRole("button", { name: "Load Grid Sample" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");

  await page.getByRole("button", { name: "Generate LOD Bundle" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state), {
      timeout: 60_000,
    })
    .toBe("Done");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkLoaded), {
      timeout: 60_000,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.playcanvasLoaded), {
      timeout: 60_000,
    })
    .toBe(true);

  const demoState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(demoState.sourceName).toBe("Generated grid sample");
  expect(demoState.outputFiles).toBeGreaterThan(0);
  expect(demoState.outputBytes).toBeGreaterThan(0);
  expect(demoState.archiveBytes).toBeGreaterThan(0);
  expect(demoState.progressPercent).toBe(100);
  expect(demoState.progressStage).toBe("Done");
  expect(demoState.progressElapsedMs).toBeGreaterThan(0);
  expect(demoState.sparkBundleKind).toBe("lod-bundle");
  expect(demoState.sparkStats?.activeFiles).toBeGreaterThan(0);
  expect(demoState.sparkActiveMeshSplats?.some((entry) => entry.numSplats > 0)).toBe(true);
  expect(demoState.sparkStats?.levelSummary).toMatch(/L\d:/);
  expect(demoState.runtimeQuaternion).toEqual([0, 0, 0, 1]);
  expect(demoState.renderQuaternion).toEqual([0, 0, 1, 0]);
  expect(demoState.playcanvasBundlePath).toBe("browser-output/lod-meta.json");
  const autoActiveSplats = demoState.sparkStats?.activeSplats ?? 0;

  await page.getByLabel("Color by LOD").check();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkDebugColorLods))
    .toBe(true);

  const debugState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(
    debugState.sparkActiveMeshSplats?.some((entry) => typeof entry.level === "number"),
  ).toBe(true);

  const lodModes = await page
    .locator("#lodModeSelect option")
    .evaluateAll((options) =>
      options
        .map((option) => option.getAttribute("value"))
        .filter((value) => value && value !== "auto" && value !== "original"),
    );

  for (const mode of lodModes) {
    await page.selectOption("#lodModeSelect", mode);
    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            mode: globalThis.__browserLodDemoState?.sparkMode,
            activeMeshSplats:
              globalThis.__browserLodDemoState?.sparkActiveMeshSplats ?? [],
          })),
        { timeout: 15_000 },
      )
      .toMatchObject({
        mode,
      });

    const previewState = await page.evaluate(() => ({
      stats: globalThis.__browserLodDemoState?.sparkStats,
      activeMeshSplats:
        globalThis.__browserLodDemoState?.sparkActiveMeshSplats ?? [],
    }));
    expect(previewState.stats?.activeSplats).toBeGreaterThan(0);
    expect(previewState.activeMeshSplats.some((entry) => entry.numSplats > 0)).toBe(true);
  }

  const coarsestMode = lodModes[lodModes.length - 1];
  const coarsestState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(coarsestState.sparkMode).toBe(coarsestMode);
  expect(autoActiveSplats).toBeGreaterThan(coarsestState.sparkStats?.activeSplats ?? 0);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Zip" }).click(),
  ]);

  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();

  const archiveBytes = new Uint8Array(await fs.readFile(archivePath));
  const entries = unzipSync(archiveBytes);
  expect(Object.keys(entries)).toContain("browser-output/lod-meta.json");

  const meta = JSON.parse(strFromU8(entries["browser-output/lod-meta.json"]));
  expect(meta.lodLevels).toBeGreaterThan(1);
  expect(Array.isArray(meta.filenames)).toBe(true);
  expect(meta.filenames.length).toBeGreaterThan(0);
  expect(consoleErrors).not.toContainEqual(expect.stringContaining("Invalid ply header"));
});

test("browser demo previews the generated grid sample before bundle generation", async ({
  page,
}) => {
  await page.goto("/demo/browser-lod/");

  await page.getByRole("button", { name: "Load Grid Sample" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkLoaded), {
      timeout: 60_000,
    })
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.playcanvasLoaded), {
      timeout: 60_000,
    })
    .toBe(true);

  const demoState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(demoState.sparkBundleKind).toBe("plain");
  expect(demoState.sparkMode).toBe("original");
  expect(demoState.playcanvasBundlePath).toBe("browser-output/generated-grid-sample.ply");
});

test("browser demo previews the original file and keeps it selectable after generation", async ({
  page,
}) => {
  await page.goto("/demo/browser-lod/");

  await page.setInputFiles(
    "#fileInput",
    path.join(fixtureDir, "minimal.splat"),
  );

  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkBundleKind))
    .toBe("plain");
  await expect(page.locator("#lodModeSelect")).toHaveValue("original");

  await page.getByRole("button", { name: "Generate LOD Bundle" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state), {
      timeout: 60_000,
    })
    .toBe("Done");
  await expect(page.locator("#lodModeSelect")).toHaveValue("auto");

  const options = await page
    .locator("#lodModeSelect option")
    .evaluateAll((nodes) => nodes.map((node) => ({
      value: node.getAttribute("value"),
      label: node.textContent?.trim(),
    })));
  expect(options.some((option) => option.value === "original")).toBe(true);
  expect(options.some((option) => option.value === "auto")).toBe(true);

  await page.selectOption("#lodModeSelect", "original");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkMode))
    .toBe("original");
});

test("browser demo can convert a source in-browser and preview the converted output", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/demo/browser-lod/");

  await page.setInputFiles(
    "#fileInput",
    path.join(fixtureDir, "minimal.splat"),
  );

  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");

  await page.selectOption("#outputFormatSelect", "compressed-ply");
  await page.getByRole("button", { name: "Convert" }).click();

  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state), {
      timeout: 60_000,
    })
    .toBe("Done");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkLoaded), {
      timeout: 60_000,
    })
    .toBe(true);

  const convertedState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(convertedState.outputFiles).toBeGreaterThan(0);
  expect(convertedState.sparkBundleKind).toBe("plain");
  expect(convertedState.playcanvasError).toBeNull();
  expect(convertedState.playcanvasLoaded).toBe(true);

  const fileNames = await page.locator("#filesList .fileName").allTextContents();
  expect(fileNames.some((name) => name.endsWith(".compressed.ply"))).toBe(true);
  await expect(page.locator("#filesSummary")).toContainText("zip");
  expect(consoleErrors).not.toContainEqual(expect.stringContaining("Invalid ply header"));
});

test("browser demo can reload a generated zip and preview it in Spark and PlayCanvas", async ({
  page,
}) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  await page.goto("/demo/browser-lod/");

  await page.getByRole("button", { name: "Load Grid Sample" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");

  await page.getByRole("button", { name: "Generate LOD Bundle" }).click();
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state), {
      timeout: 60_000,
    })
    .toBe("Done");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download Zip" }).click(),
  ]);
  const archivePath = await download.path();
  expect(archivePath).not.toBeNull();
  const archiveBytes = await fs.readFile(archivePath);

  await page.goto("/demo/browser-lod/");
  await page.setInputFiles("#fileInput", {
    name: "reloaded-sample.zip",
    mimeType: "application/zip",
    buffer: archiveBytes,
  });

  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.state))
    .toBe("Ready");
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.sparkLoaded))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => globalThis.__browserLodDemoState?.playcanvasLoaded), {
      timeout: 60_000,
    })
    .toBe(true);

  const reloadedState = await page.evaluate(() => globalThis.__browserLodDemoState);
  expect(reloadedState.sparkBundleKind).toBe("lod-bundle");
  expect(reloadedState.playcanvasError).toBeNull();
  expect(consoleErrors).not.toContainEqual(expect.stringContaining("Invalid ply header"));
});
