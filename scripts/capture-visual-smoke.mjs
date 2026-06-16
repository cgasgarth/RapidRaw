import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const host = '127.0.0.1';
const port = 1420;
const baseUrl = `http://${host}:${port}`;
const outputDir = resolve('artifacts/visual-smoke');
const viewport = { width: 1440, height: 960 };
const scenarioArgIndex = process.argv.indexOf('--scenario');
const requestedScenario = scenarioArgIndex >= 0 ? process.argv[scenarioArgIndex + 1] : null;
const scenarios = [
  {
    marker: 'Editor Preview',
    mode: 'empty-library',
    outputPath: resolve(outputDir, 'empty-library.png'),
    sectionMinimum: 4,
  },
  {
    marker: 'Panorama setup',
    mode: 'panorama-ui',
    outputPath: resolve(outputDir, 'panorama-ui.png'),
    sectionMinimum: 1,
  },
  {
    marker: 'Focus-stack plan',
    mode: 'focus-ui',
    outputPath: resolve(outputDir, 'focus-ui.png'),
    sectionMinimum: 1,
  },
  {
    marker: 'HDR merge setup',
    mode: 'hdr-ui',
    outputPath: resolve(outputDir, 'hdr-ui.png'),
    sectionMinimum: 1,
  },
  {
    marker: 'Super-resolution plan',
    mode: 'sr-ui',
    outputPath: resolve(outputDir, 'sr-ui.png'),
    sectionMinimum: 1,
  },
  {
    marker: 'Negative Conversion',
    mode: 'negative-lab-workspace',
    outputPath: resolve(outputDir, 'negative-lab-workspace.png'),
    sectionMinimum: 1,
  },
  {
    marker: 'Film Looks',
    mode: 'film-look-browser',
    outputPath: resolve(outputDir, 'film-look-browser.png'),
    sectionMinimum: 2,
  },
  {
    marker: 'Color Workflow',
    mode: 'color-workflow',
    outputPath: resolve(outputDir, 'color-workflow.png'),
    sectionMinimum: 2,
  },
];
const highDpiTargets = [
  { deviceScaleFactor: 1, name: 'empty-library-1x.png' },
  { deviceScaleFactor: 2, name: 'empty-library-2x.png' },
];
const warmPrintPresetSchema = z
  .object({
    adjustments: z.object({
      contrast: z.literal(5),
      highlights: z.literal(-6),
      temperature: z.literal(5),
    }),
    includeCropTransform: z.literal(false),
    includeMasks: z.literal(false),
    name: z.literal('Warm Print 65%'),
    presetType: z.literal('style'),
  })
  .passthrough();
const visualSmokeInvokeLogSchema = z.array(
  z.object({
    args: z.unknown().optional(),
    command: z.string(),
    options: z.unknown().optional(),
  }),
);
const hdrUiSettingsProofSchema = z.object({
  deghosting: z.literal('high'),
  maxPreviewDimensionPx: z.literal('8192'),
  toneMapPreview: z.literal('false'),
});
const panoramaUiSettingsProofSchema = z.object({
  blendMode: z.literal('feather'),
  boundaryMode: z.literal('transparent'),
  exposureMode: z.literal('none'),
  maxPreviewDimensionPx: z.literal('8192'),
  projection: z.literal('spherical'),
  qualityPreference: z.literal('preview'),
});
const focusUiSettingsProofSchema = z.object({
  alignmentMode: z.literal('homography'),
  blendMethod: z.literal('depth_map'),
  maxPreviewDimensionPx: z.literal('8192'),
  qualityPreference: z.literal('preview'),
  retouchLayerPolicy: z.literal('none'),
});
const superResolutionUiSettingsProofSchema = z.object({
  alignmentMode: z.literal('optical_flow'),
  detailPolicy: z.literal('aggressive_preview_only'),
  maxPreviewDimensionPx: z.literal('8192'),
  outputScale: z.literal('4'),
  qualityPreference: z.literal('preview'),
});
const selectedScenarios =
  requestedScenario === null ? scenarios : scenarios.filter((scenario) => scenario.mode === requestedScenario);

if (selectedScenarios.length === 0) {
  throw new Error(`Unknown visual smoke scenario: ${requestedScenario ?? '<missing>'}`);
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

async function waitForDevServer() {
  const startedAt = Date.now();
  const timeoutMs = 45_000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for Vite at ${baseUrl}`);
}

async function stopDevServer(server) {
  if (server.exitCode !== null || server.signalCode !== null) {
    return;
  }

  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveStop) => {
      server.once('exit', resolveStop);
    }),
    sleep(5_000).then(() => {
      server.kill('SIGKILL');
    }),
  ]);
}

async function readPngDimensions(path) {
  const buffer = await readFile(path);
  if (buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error(`${path} is not a PNG file.`);
  }

  return {
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

async function assertSectionCount(page, minimum) {
  const sectionCount = await page.locator('[data-visual-smoke-section]').count();
  if (sectionCount < minimum) {
    throw new Error(`Expected at least ${minimum} visual smoke sections, found ${sectionCount}`);
  }
}

async function assertFilmLookExportProof(page) {
  const invokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const savedPreset = invokeLog.find((call) => call.command === 'save_community_preset');
  const exportedPreset = invokeLog.find((call) => call.command === 'handle_export_presets_to_file');

  if (savedPreset === undefined) {
    throw new Error('Film look save invoke was not recorded.');
  }

  warmPrintPresetSchema.parse(savedPreset.args);

  if (exportedPreset === undefined) {
    throw new Error('Film look export invoke was not recorded.');
  }

  z.object({
    filePath: z.literal('/tmp/rawengine-film-look-smoke.rrpreset'),
    presetsToExport: z
      .array(
        z.object({
          preset: warmPrintPresetSchema.extend({ id: z.string().uuid() }),
        }),
      )
      .length(1),
  }).parse(exportedPreset.args);
}

async function prepareScenario(page, mode) {
  if (mode === 'focus-ui') {
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Homography' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Depth map/u }).click();
    await page.getByRole('button', { name: /None\s+Flattened preview/u }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    focusUiSettingsProofSchema.parse(
      await page.getByTestId('focus-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'sr-ui') {
    await page.getByRole('button', { name: '4x' }).click();
    await page.getByRole('button', { exact: true, name: 'Auto' }).click();
    await page.getByRole('option', { name: 'Optical flow' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Aggressive preview/u }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    superResolutionUiSettingsProofSchema.parse(
      await page.getByTestId('sr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'hdr-ui') {
    await page.getByRole('button', { name: 'High' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    await page.getByLabel('Tone-map preview').uncheck();
    hdrUiSettingsProofSchema.parse(
      await page.getByTestId('hdr-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'panorama-ui') {
    await page.getByRole('button', { name: 'Cylindrical' }).click();
    await page.getByRole('option', { name: 'Spherical' }).click();
    await page.getByRole('button', { exact: true, name: 'Best' }).click();
    await page.getByRole('option', { name: 'Preview' }).click();
    await page.getByRole('button', { name: /Feather/u }).click();
    await page.getByRole('button', { name: 'Auto crop' }).click();
    await page.getByRole('option', { name: 'Transparent edge' }).click();
    await page.getByRole('button', { name: 'Gain compensation' }).click();
    await page.getByRole('option', { name: 'None' }).click();
    await page.getByRole('button', { name: '8192 px' }).click();
    panoramaUiSettingsProofSchema.parse(
      await page.getByTestId('panorama-ui-settings-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

  if (mode === 'color-workflow') {
    const colorSliders = page.locator('[data-visual-smoke-mode="color-workflow"] input[type="range"]');
    await colorSliders.nth(0).fill('12');
    await colorSliders.nth(3).fill('18');
    await page.getByRole('button', { name: 'Off' }).nth(1).click();
    await page.getByRole('button', { name: 'Off' }).nth(1).click();
    await page.getByTestId('color-workflow-adjustment-proof').getByText('Temp 12', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('Sat 18', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('CB on', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('color-workflow-adjustment-proof').getByText('CM on', { exact: true }).waitFor({
      timeout: 10_000,
    });
    return;
  }

  if (mode === 'film-look-browser') {
    await page.getByLabel('Warm Print', { exact: true }).click();
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 5').waitFor({ timeout: 10_000 });
    await page.getByLabel('Compare A: Warm Print').click();
    await page.getByLabel('Save Warm Print as preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Saved Warm Print 65%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Share Warm Print preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Exported Warm Print 65%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await assertFilmLookExportProof(page);
    return;
  }

  if (mode !== 'negative-lab-workspace') return;

  await page.getByTestId('negative-lab-workspace').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-workflow-rail').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-batch-readiness').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-include-toggle-1').click();
  await page
    .getByTestId('negative-lab-queued-count')
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-included-status').getByText('1 included', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-scope-active').click();
  await page
    .getByTestId('negative-lab-queued-count')
    .getByText('1 queued', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-sample-left-edge').click();
  await page.getByTestId('negative-lab-base-sample-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-confidence').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-tiff16').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-jpeg-proof').click();
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  let serverOutput = '';
  const server = spawn('bun', ['run', 'dev', '--', '--host', host], {
    env: { ...process.env, RAWENGINE_VISUAL_SMOKE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const captureServerOutput = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-4_000);
  };

  server.stdout.on('data', captureServerOutput);
  server.stderr.on('data', captureServerOutput);

  let browser;

  try {
    await waitForDevServer();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ deviceScaleFactor: 1, viewport });

    page.on('pageerror', (error) => {
      throw error;
    });

    for (const scenario of selectedScenarios) {
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.mode}`, { waitUntil: 'networkidle' });
      await page.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await page.getByText(scenario.marker, { exact: true }).waitFor({ timeout: 10_000 });
      await assertSectionCount(page, scenario.sectionMinimum);
      await prepareScenario(page, scenario.mode);
      await page.screenshot({ path: scenario.outputPath, fullPage: false });
      const dimensions = await readPngDimensions(scenario.outputPath);
      if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) {
        throw new Error(
          `${scenario.mode} dimensions mismatch: expected ${viewport.width}x${viewport.height}, got ${dimensions.width}x${dimensions.height}`,
        );
      }
    }

    await page.close();

    const shouldCheckHighDpi = requestedScenario === null || requestedScenario === 'empty-library';
    for (const target of shouldCheckHighDpi ? highDpiTargets : []) {
      const highDpiPage = await browser.newPage({ deviceScaleFactor: target.deviceScaleFactor, viewport });
      highDpiPage.on('pageerror', (error) => {
        throw error;
      });

      await highDpiPage.goto(`${baseUrl}/visual-smoke.html?scenario=empty-library`, { waitUntil: 'networkidle' });
      await highDpiPage.locator('[data-visual-smoke-ready="true"]').waitFor({ timeout: 10_000 });
      await assertSectionCount(highDpiPage, 4);

      const outputPath = resolve(outputDir, target.name);
      await highDpiPage.screenshot({ path: outputPath, fullPage: false });
      await highDpiPage.close();

      const dimensions = await readPngDimensions(outputPath);
      const expectedWidth = viewport.width * target.deviceScaleFactor;
      const expectedHeight = viewport.height * target.deviceScaleFactor;
      if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
        throw new Error(
          `${target.name} dimensions mismatch: expected ${expectedWidth}x${expectedHeight}, got ${dimensions.width}x${dimensions.height}`,
        );
      }

      console.log(`visual-smoke ${target.name} ok ${dimensions.width}x${dimensions.height}`);
    }
    console.log(`visual-smoke ok (${selectedScenarios.map((scenario) => scenario.mode).join(', ')})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Executable doesn')) {
      console.error('Playwright Chromium is not installed. Run: bunx playwright install chromium');
    }
    if (serverOutput.trim().length > 0) {
      console.error(`Vite output excerpt:\n${serverOutput.trim()}`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopDevServer(server);
  }
}

await main();
