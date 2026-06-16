#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  buildNegativeLabBatchSummaryRouteResult,
  buildNegativeLabConversionPlanResult,
  buildNegativeLabFrameHealthRouteResult,
  NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST,
} from '../src/utils/negativeLabAppServerRoutes.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../src/utils/negativeLabPresetCatalog.ts';

const expectedBatchSummaryCommandName = 'negative.lab.build_batch_dry_run_summary';
const expectedCommandName = 'negative.lab.build_conversion_plan';
const expectedFrameHealthCommandName = 'negative.lab.build_frame_health_report';
const batchSummaryRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedBatchSummaryCommandName,
);
const route = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedCommandName,
);
const frameHealthRoute = NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.find(
  (candidate) => candidate.commandName === expectedFrameHealthCommandName,
);

if (batchSummaryRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedBatchSummaryCommandName}.`);
}
if (route === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedCommandName}.`);
}
if (frameHealthRoute === undefined) {
  throw new Error(`Missing Negative Lab app-server route for ${expectedFrameHealthCommandName}.`);
}

const sampleRect = { height: 0.6, width: 0.12, x: 0.02, y: 0.2 };
const conversionPlanResultSchema = z.object({
  commandName: z.literal(expectedCommandName),
  outputFormat: z.enum(['jpeg_proof', 'tiff16']),
  params: z.object({
    base_fog_sample: z.union([
      z.null(),
      z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() }),
    ]),
    base_fog_strength: z.number(),
    blue_weight: z.number(),
    contrast: z.number(),
    exposure: z.number(),
    green_weight: z.number(),
    red_weight: z.number(),
  }),
  paths: z.array(z.string()).min(1),
  presetId: z.string(),
  proof: z.object({
    deterministic: z.literal(true),
    generatedFrom: z.literal('src/utils/negativeLabPresetCatalog.ts'),
  }),
  sampleRect: z.union([z.null(), z.object({ height: z.number(), width: z.number(), x: z.number(), y: z.number() })]),
  scope: z.enum(['active', 'all']),
  suffix: z.string(),
});
const assertParamsMatch = (actualParams, expectedParams, label) => {
  for (const key of [
    'base_fog_sample',
    'base_fog_strength',
    'blue_weight',
    'contrast',
    'exposure',
    'green_weight',
    'red_weight',
  ]) {
    if (JSON.stringify(actualParams[key]) !== JSON.stringify(expectedParams[key])) {
      throw new Error(`${label} ${key} does not match UI preset catalog.`);
    }
  }
};

const frameHealthResult = buildNegativeLabFrameHealthRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});
const batchSummaryResult = buildNegativeLabBatchSummaryRouteResult({
  activePathIndex: 1,
  baseFogConfidence: 0.82,
  includedPaths: ['/roll/001.CR3', '/roll/002.CR3'],
  previewReady: false,
  targetPaths: ['/roll/001.CR3', '/roll/002.CR3', '/roll/003.CR3'],
});

if (frameHealthResult.activeFrameId !== 'negative-lab-frame-2') {
  throw new Error('Negative Lab app-server frame health route did not report the active frame.');
}
if (frameHealthResult.includedCount !== 2 || frameHealthResult.queuedCount !== 2) {
  throw new Error('Negative Lab app-server frame health route did not report roll counts.');
}
if (!frameHealthResult.warningCodes.includes('excluded_from_batch')) {
  throw new Error('Negative Lab app-server frame health route did not roll up skipped-frame warnings.');
}
if (batchSummaryResult.plannedApplyCount !== 2 || batchSummaryResult.skippedFrameIds[0] !== 'negative-lab-frame-3') {
  throw new Error('Negative Lab app-server batch summary route did not report apply/skip counts.');
}
if (!batchSummaryResult.rollWarningCodes.includes('excluded_from_batch')) {
  throw new Error('Negative Lab app-server batch summary route did not roll up warnings.');
}

for (const preset of NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets) {
  const activeResult = conversionPlanResultSchema.parse(
    buildNegativeLabConversionPlanResult({
      outputFormat: 'jpeg_proof',
      paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
      presetId: preset.presetId,
      sampleRect,
      scope: 'active',
      suffix: 'Positive',
    }),
  );
  const batchResult = conversionPlanResultSchema.parse(
    buildNegativeLabConversionPlanResult({
      outputFormat: 'tiff16',
      paths: [
        '/fixtures/negative-lab/synthetic-color-negative-001.tif',
        '/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif',
      ],
      presetId: preset.presetId,
      sampleRect: null,
      scope: 'all',
      suffix: 'Positive',
    }),
  );

  assertParamsMatch(activeResult.params, { ...preset.params, base_fog_sample: sampleRect }, preset.displayName);
  assertParamsMatch(batchResult.params, preset.params, preset.displayName);
}

try {
  buildNegativeLabConversionPlanResult({
    outputFormat: 'tiff16',
    paths: ['/fixtures/negative-lab/synthetic-color-negative-001.tif'],
    presetId: 'negative_lab.generic.c41.missing.v1',
    sampleRect: null,
    scope: 'active',
    suffix: 'Positive',
  });
  throw new Error('Unknown Negative Lab preset id was accepted.');
} catch (error) {
  if (error instanceof Error && error.message === 'Unknown Negative Lab preset id was accepted.') {
    throw error;
  }
}

for (const [filePath, marker] of [
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabBatchSummaryAppServerCommandSchema'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabFrameHealthAppServerCommandSchema'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabBatchSummaryRouteResult'],
  ['src/schemas/negativeLabAppServerSchemas.ts', 'negativeLabConversionPlanResultSchema'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabFrameHealthRouteResult'],
  ['src/utils/negativeLabAppServerRoutes.ts', 'buildNegativeLabConversionPlanResult'],
  ['src/utils/negativeLabPresetCatalog.ts', 'NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG'],
]) {
  const source = await readFile(filePath, 'utf8');
  if (!source.includes(marker)) {
    throw new Error(`${filePath} is missing Negative Lab app-server marker ${marker}.`);
  }
}

console.log(
  `negative lab app-server routes ok (${NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.length} presets, ${NEGATIVE_LAB_APP_SERVER_ROUTE_MANIFEST.routes.length} routes)`,
);
