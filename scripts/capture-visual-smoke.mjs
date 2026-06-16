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
    marker: 'Command Palette Workflows',
    mode: 'command-palette-workflows',
    outputPath: resolve(outputDir, 'command-palette-workflows.png'),
    sectionMinimum: 1,
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
    appMode: 'negative-lab-workspace',
    marker: 'Negative Conversion',
    mode: 'negative-lab-batch-color-workspace',
    outputPath: resolve(outputDir, 'negative-lab-batch-color-workspace.png'),
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
const filmLookPresetBaseSchema = z
  .object({
    includeCropTransform: z.literal(false),
    includeMasks: z.literal(false),
    presetType: z.literal('style'),
  })
  .passthrough();
const warmPrintPresetSchema = filmLookPresetBaseSchema.extend({
  adjustments: z.object({
    contrast: z.literal(8),
    highlights: z.literal(-10),
    temperature: z.literal(8),
  }),
  name: z.literal('Warm Print 100%'),
});
const monoSilverPresetSchema = filmLookPresetBaseSchema.extend({
  adjustments: z.object({
    contrast: z.literal(12),
    grainAmount: z.literal(22),
    grainSize: z.literal(42),
    saturation: z.literal(-100),
  }),
  name: z.literal('Mono Silver 100%'),
});
const exportedFilmLookPresetSchema = z.union([
  warmPrintPresetSchema.extend({ id: z.string().uuid() }),
  monoSilverPresetSchema.extend({ id: z.string().uuid() }),
]);
const filmLookExportArgsSchema = z.object({
  filePath: z.literal('/tmp/rawengine-film-look-smoke.rrpreset'),
  presetsToExport: z
    .array(
      z.object({
        preset: exportedFilmLookPresetSchema,
      }),
    )
    .length(1),
});
const filmLookSaveCommandSchema = z.union([
  z.object({
    args: warmPrintPresetSchema,
    command: z.literal('save_community_preset'),
    options: z.unknown().optional(),
  }),
  z.object({
    args: monoSilverPresetSchema,
    command: z.literal('save_community_preset'),
    options: z.unknown().optional(),
  }),
]);
const filmLookExportCommandSchema = z.object({
  args: filmLookExportArgsSchema,
  command: z.literal('handle_export_presets_to_file'),
  options: z.unknown().optional(),
});
const filmLookInvokeLogSchema = z.array(z.union([filmLookSaveCommandSchema, filmLookExportCommandSchema]));
const filmLookExportProofSchema = z.object({
  exportedNames: z.array(z.string()).superRefine((names, context) => {
    for (const expectedName of ['Warm Print 100%', 'Mono Silver 100%']) {
      if (!names.includes(expectedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing exported film look preset ${expectedName}.`,
        });
      }
    }
  }),
  savedNames: z.array(z.string()).superRefine((names, context) => {
    for (const expectedName of ['Warm Print 100%', 'Mono Silver 100%']) {
      if (!names.includes(expectedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing saved film look preset ${expectedName}.`,
        });
      }
    }
  }),
});
const visualSmokeInvokeLogSchema = z.array(
  z.object({
    args: z.unknown().optional(),
    command: z.string(),
    options: z.unknown().optional(),
  }),
);
const negativeLabLeftEdgeSampleSchema = z.object({
  height: z.literal(0.6),
  width: z.literal(0.12),
  x: z.literal(0.02),
  y: z.literal(0.2),
});
const negativeLabCustomBaseSampleSchema = z.object({
  height: z.literal(0.18),
  width: z.literal(0.18),
  x: z.literal(0.25),
  y: z.literal(0.25),
});
const negativeLabShadowPatchSampleSchema = z.object({
  height: z.literal(0.18),
  width: z.literal(0.18),
  x: z.literal(0.18),
  y: z.literal(0.62),
});
const negativeLabOrthoPresetParamsSchema = z
  .object({
    base_fog_sample: z.union([negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    blue_weight: z.literal(1.18),
    contrast: z.literal(1.2),
    exposure: z.literal(-0.05),
    green_weight: z.literal(0.96),
    red_weight: z.literal(1.07),
  })
  .passthrough();
const negativeLabPreviewParamsSchema = z
  .object({
    base_fog_sample: z.union([z.null(), negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    blue_weight: z.number(),
    contrast: z.number(),
    exposure: z.number(),
    green_weight: z.number(),
    red_weight: z.number(),
  })
  .passthrough();
const negativeLabFixturePathSchema = z.union([
  z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
  z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif'),
]);
const negativeLabPreviewInvokeSchema = z.object({
  args: z.object({
    params: negativeLabPreviewParamsSchema,
    path: negativeLabFixturePathSchema,
  }),
  command: z.literal('preview_negative_conversion'),
  options: z.unknown().optional(),
});
const negativeLabBaseFogEstimateInvokeSchema = z.object({
  args: z.object({
    path: z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
    sampleRect: z.union([
      z.null(),
      negativeLabLeftEdgeSampleSchema,
      negativeLabCustomBaseSampleSchema,
      negativeLabShadowPatchSampleSchema,
    ]),
  }),
  command: z.literal('estimate_negative_base_fog'),
  options: z.unknown().optional(),
});
const negativeLabConvertArgsSchema = z.object({
  options: z.object({
    outputFormat: z.literal('jpeg_proof'),
    suffix: z.literal('Positive'),
  }),
  params: negativeLabOrthoPresetParamsSchema,
  paths: z.array(z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif')).length(1),
});
const negativeLabBatchColorParamsSchema = z
  .object({
    base_fog_sample: z.null(),
    base_fog_strength: z.literal(1),
    blue_weight: z.literal(1.14),
    contrast: z.literal(1),
    exposure: z.literal(0),
    green_weight: z.literal(0.91),
    red_weight: z.literal(1.23),
  })
  .passthrough();
const negativeLabBatchConvertArgsSchema = z.object({
  options: z
    .object({
      acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
      outputFormat: z.literal('jpeg_proof'),
      suffix: z.literal('Positive'),
    })
    .refine(
      (options) =>
        options.acceptedDryRunPlanId ===
        `negative_lab_batch_plan_${options.acceptedDryRunPlanHash.replace('fnv1a32:', '')}`,
      'accepted batch plan id must match hash',
    ),
  params: negativeLabBatchColorParamsSchema,
  paths: z
    .array(
      z.union([
        z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
        z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif'),
      ]),
    )
    .length(2),
});
const negativeLabPreviewReturnProofSchema = z.array(z.string().startsWith('data:image/svg+xml,')).min(3);
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
const commandPaletteWorkflowProofSchema = z.object({
  focusOpen: z.literal('true'),
  hdrOpen: z.literal('true'),
  negativeOpen: z.literal('true'),
  panoramaOpen: z.literal('true'),
  srOpen: z.literal('true'),
});
const negativeLabWorkspaceProofDatasetSchema = z.object({
  activeStage: z.enum(['colorInversion', 'export', 'inspection']),
  exportReady: z.enum(['false', 'true']),
  previewReady: z.literal('true'),
  queuedCount: z.string().regex(/^[1-9][0-9]*$/u),
  reviewCount: z.string().regex(/^[0-9]+$/u),
  retouchCount: z.literal('0'),
  schemaVersion: z.literal('1'),
  targetCount: z.string().regex(/^[1-9][0-9]*$/u),
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
  const rawInvokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const invokeLog = filmLookInvokeLogSchema.parse(
    rawInvokeLog.filter((call) => ['handle_export_presets_to_file', 'save_community_preset'].includes(call.command)),
  );
  const savedNames = invokeLog.filter((call) => call.command === 'save_community_preset').map((call) => call.args.name);
  const exportedNames = invokeLog
    .filter((call) => call.command === 'handle_export_presets_to_file')
    .map((call) => call.args.presetsToExport[0]?.preset.name ?? '<missing>');

  filmLookExportProofSchema.parse({ exportedNames, savedNames });
}

async function assertNegativeLabInvokeProof(page) {
  const invokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const convertCall = invokeLog.find((call) => call.command === 'convert_negatives');

  if (convertCall === undefined) {
    throw new Error('Negative Lab convert invoke was not recorded.');
  }

  negativeLabConvertArgsSchema.parse(convertCall.args);
}

async function assertNegativeLabBaseFogPreviewExportProof(page) {
  const rawInvokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const previewCalls = z
    .array(negativeLabPreviewInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'preview_negative_conversion'));
  const estimateCalls = z
    .array(negativeLabBaseFogEstimateInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'estimate_negative_base_fog'));
  const previewReturns = negativeLabPreviewReturnProofSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__ ?? []),
  );
  const hasAutoEstimate = estimateCalls.some((call) => call.args.sampleRect === null);
  const hasManualEstimate = estimateCalls.some((call) => call.args.sampleRect !== null);
  const hasCustomBaseEstimate = estimateCalls.some(
    (call) => negativeLabCustomBaseSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasPatchProbeEstimate = estimateCalls.some(
    (call) => negativeLabShadowPatchSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasAutoPreview = previewCalls.some(
    (call) => call.args.params.base_fog_sample === null && call.args.params.red_weight === 1.07,
  );
  const hasManualPreview = previewCalls.some(
    (call) => call.args.params.base_fog_sample !== null && call.args.params.blue_weight === 1.18,
  );
  const hasCustomBasePreview = previewCalls.some(
    (call) => negativeLabCustomBaseSampleSchema.safeParse(call.args.params.base_fog_sample).success,
  );

  if (
    !hasAutoEstimate ||
    !hasManualEstimate ||
    !hasCustomBaseEstimate ||
    !hasPatchProbeEstimate ||
    !hasAutoPreview ||
    !hasManualPreview ||
    !hasCustomBasePreview
  ) {
    throw new Error('Negative Lab base/fog proof did not exercise auto and sampled preview paths.');
  }

  if (new Set(previewReturns).size < 2) {
    throw new Error('Negative Lab sampled preview proof did not produce distinct preview render payloads.');
  }
}

async function assertNegativeLabBatchColorInvokeProof(page) {
  const invokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const convertCall = invokeLog.find((call) => call.command === 'convert_negatives');

  if (convertCall === undefined) {
    throw new Error('Negative Lab batch convert invoke was not recorded.');
  }

  negativeLabBatchConvertArgsSchema.parse(convertCall.args);
}

async function prepareScenario(page, mode) {
  if (mode === 'command-palette-workflows') {
    const runCommand = async (query, name) => {
      await page.getByLabel('Search commands').fill(query);
      await page.getByRole('button', { name }).click();
      await page.getByTestId('command-palette-open').click();
    };

    await runCommand('focus', /Open focus stacking/u);
    await runCommand('super', /Open super resolution/u);
    await runCommand('panorama', /Open panorama stitching/u);
    await runCommand('hdr', /Open HDR merge/u);
    await runCommand('negative', /Open negative lab/u);
    commandPaletteWorkflowProofSchema.parse(
      await page.getByTestId('command-palette-workflow-proof').evaluate((element) => ({ ...element.dataset })),
    );
    return;
  }

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
    await page.getByTestId('film-look-rendered-proof').getByText('Rendered parity proof', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-rendered-proof').getByText('Mono Silver', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-rendered-proof').getByText('7e4b525fd7be754b', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Warm Print', { exact: true }).click();
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 5').waitFor({ timeout: 10_000 });
    await page.getByRole('slider', { name: 'Strength' }).fill('100');
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 8', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Compare A: Warm Print').click();
    await page.getByLabel('Save Warm Print as preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Saved Warm Print 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Share Warm Print preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Exported Warm Print 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Mono Silver', { exact: true }).click();
    await page.getByTestId('film-look-adjustment-proof').getByText('Temp 0', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByTestId('film-look-adjustment-proof').getByText('Grain 17', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByRole('slider', { name: 'Strength' }).fill('100');
    await page.getByTestId('film-look-adjustment-proof').getByText('Grain 22', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Compare A: Mono Silver').click();
    await page.getByLabel('Save Mono Silver as preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Saved Mono Silver 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await page.getByLabel('Share Mono Silver preset').click();
    await page.getByTestId('film-look-preset-status').getByText('Exported Mono Silver 100%', { exact: true }).waitFor({
      timeout: 10_000,
    });
    await assertFilmLookExportProof(page);
    return;
  }

  if (mode === 'negative-lab-batch-color-workspace') {
    await page.getByTestId('negative-lab-workspace').waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-batch-readiness').waitFor({ timeout: 10_000 });
    await page
      .getByTestId('negative-lab-queued-count')
      .getByText('2 queued', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-accept-batch-plan').click();
    await page
      .getByTestId('negative-lab-accept-batch-plan')
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    const colorSliders = page.locator('input[type="range"]');
    await colorSliders.nth(1).fill('1.23');
    await colorSliders.nth(2).fill('0.91');
    await colorSliders.nth(3).fill('1.14');
    await page.getByTestId('negative-lab-accept-batch-plan').click();
    await page
      .getByTestId('negative-lab-accept-batch-plan')
      .getByText('Batch plan accepted', { exact: true })
      .waitFor({ timeout: 10_000 });
    await page.getByTestId('negative-lab-export-jpeg-proof').click();
    await page.getByRole('button', { name: 'Convert & Save All (2)' }).click();
    await page.waitForFunction(() =>
      (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
    );
    await assertNegativeLabBatchColorInvokeProof(page);
    await page
      .getByTestId('negative-lab-saved-path-proof')
      .getByText('/tmp/rawengine-negative-smoke-positive.tif', { exact: true })
      .waitFor({ timeout: 10_000 });
    return;
  }

  if (mode !== 'negative-lab-workspace') return;

  await page.getByTestId('negative-lab-workspace').waitFor({ timeout: 10_000 });
  await page.waitForFunction(
    () => document.querySelector('[data-testid="negative-lab-workspace-proof"]')?.dataset.previewReady === 'true',
  );
  negativeLabWorkspaceProofDatasetSchema.parse(
    await page.getByTestId('negative-lab-workspace-proof').evaluate((element) => ({ ...element.dataset })),
  );
  await page.getByTestId('negative-lab-workflow-rail').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-batch-readiness').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-dust-review').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-retouch-count').getByText('Retouch 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-count').getByText('Frames 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 2', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 0', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-active-scan-1').click();
  await page.getByTestId('negative-lab-frame-health-row-1').getByText('Active', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-frame-health-row-0').getByText('Queued', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-active-scan-0').click();
  await page.getByTestId('negative-lab-preset-inspector').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preset-film-class').getByText('Color negative', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Black and White Ortho' }).click();
  await page
    .getByTestId('negative-lab-preset-process')
    .getByText('Silver gelatin family / Ortho-style silver negative', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-film-class')
    .getByText('Black and white silver', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-claim-level')
    .getByText('Generic starting point', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-runtime-status')
    .getByText('Runtime applied', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-intent')
    .getByText('Orthochromatic-style tonal separation with reduced red response.', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-preset-metadata').waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-speed-class')
    .getByText('Low to medium speed family', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-contrast-curve')
    .getByText('Medium separation curve', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-color-response')
    .getByText('Color response: Reduced red response and stronger blue weighting for ortho-style separation.', {
      exact: true,
    })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-preset-claim-policy')
    .getByText('Generic family descriptor only; no manufacturer, stock, or emulation claim.', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-auto-base-fog').click();
  await page.getByTestId('negative-lab-base-status').getByText('Base 91%', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-sample-left-edge').click();
  await page.getByTestId('negative-lab-roll-warning-count').getByText('Warnings 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page
    .getByTestId('negative-lab-base-rgb-readout')
    .getByText('183 / 147 / 112', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page
    .getByTestId('negative-lab-base-density-readout')
    .getByText('0.145 / 0.238 / 0.356', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-density-spread').getByText('0.211', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-dominant-density-channel').getByText('Blue', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-neutrality-status').getByText('Strong cast', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-shadow-patch').click();
  await page.getByTestId('negative-lab-patch-probe-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-patch-probe-readout').getByText('Shadow patch', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-density-spread').getByText('0.211', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-patch-probe-dominant-channel').getByText('Blue', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-custom-base-overlay').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-custom-base-area').getByText('Area 3%', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-measure-custom-base').click();
  await page.getByTestId('negative-lab-custom-base-rgb').getByText('183 / 147 / 112', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-apply-custom-base').click();
  await page
    .getByTestId('negative-lab-base-sample-readout')
    .getByText('Custom base sample', { exact: true })
    .waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-copy-readout').click();
  await page.getByTestId('negative-lab-copy-readout').getByText('Copied readout', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const copiedReadout = await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__?.at(-1) ?? '');
  if (!copiedReadout.includes('"baseDensity"') || !copiedReadout.includes('"sampleLabel"')) {
    throw new Error('Negative Lab readout copy did not include density/sample JSON.');
  }
  await page.getByTestId('negative-lab-include-toggle-1').click();
  await page.getByTestId('negative-lab-planned-apply-count').getByText('Apply 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-skipped-frame-count').getByText('Skip 1', { exact: true }).waitFor({
    timeout: 10_000,
  });
  await page.getByTestId('negative-lab-copy-batch-plan').click();
  await page.getByTestId('negative-lab-copy-batch-plan').getByText('Copied plan', { exact: true }).waitFor({
    timeout: 10_000,
  });
  const copiedBatchPlan = await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__?.at(-1) ?? '');
  if (!copiedBatchPlan.includes('"plannedApplyCount"') || !copiedBatchPlan.includes('"skippedFrameIds"')) {
    throw new Error('Negative Lab batch plan copy did not include apply/skip JSON.');
  }
  await page.getByTestId('negative-lab-accept-batch-plan').click();
  await page
    .getByTestId('negative-lab-accept-batch-plan')
    .getByText('Batch plan accepted', { exact: true })
    .waitFor({ timeout: 10_000 });
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
  await page.getByTestId('negative-lab-export-tiff16').waitFor({ timeout: 10_000 });
  await page.getByTestId('negative-lab-export-jpeg-proof').click();
  await page.getByRole('button', { name: 'Convert & Save Active' }).click();
  await page.waitForFunction(() =>
    (window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []).some((call) => call.command === 'convert_negatives'),
  );
  await assertNegativeLabInvokeProof(page);
  await assertNegativeLabBaseFogPreviewExportProof(page);
  await page
    .getByTestId('negative-lab-saved-path-proof')
    .getByText('/tmp/rawengine-negative-smoke-positive.tif', { exact: true })
    .waitFor({ timeout: 10_000 });
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
    await page.addInitScript(() => {
      window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__ = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__RAWENGINE_NEGATIVE_LAB_CLIPBOARD_WRITES__.push(text);
          },
        },
      });
    });

    page.on('pageerror', (error) => {
      throw error;
    });

    for (const scenario of selectedScenarios) {
      await page.goto(`${baseUrl}/visual-smoke.html?scenario=${scenario.appMode ?? scenario.mode}`, {
        waitUntil: 'networkidle',
      });
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
