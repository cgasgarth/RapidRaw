#!/usr/bin/env bun

import { z } from 'zod';

import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';
import { buildNegativeLabPlanRollNormalizationRouteResult } from '../../../src/utils/negativeLabAppServerRoutes.ts';
import { buildNegativeLabRollNormalizationPlan } from '../../../src/utils/negativeLabRollNormalizationPlan.ts';
import {
  buildNegativeLabScanMetricsV1,
  type NegativeLabScanMetricPixel,
} from '../../../src/utils/negativeLabScanMetrics.ts';

const transcriptSchema = z
  .object({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    exposureOverrideCount: z.number().int().nonnegative(),
    positiveVariantIds: z.array(z.string().trim().min(1)),
    routeAffectedFrameIds: z.array(z.string().trim().min(1)),
    rgbOverrideCount: z.number().int().nonnegative(),
    suggestionCount: z.number().int().nonnegative(),
    suggestionState: z.string().trim().min(1),
    unaffectedFrameIds: z.array(z.string().trim().min(1)),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

const buildPixels = (p50: number, range: number) =>
  Array.from({ length: 24 * 24 }, (_, index): NegativeLabScanMetricPixel => {
    const x = index % 24;
    const y = Math.floor(index / 24);
    const density = Math.max(0.04, p50 + ((x + y) / 46 - 0.5) * range);
    return { b: Math.pow(10, -density), g: Math.pow(10, -density), r: Math.pow(10, -density) };
  });

const targetPaths = [
  '/proof-roll/negative-lab/frame-0001.tif',
  '/proof-roll/negative-lab/frame-0002.tif',
  '/proof-roll/negative-lab/frame-0003.tif',
];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.91,
  baseScope: 'roll',
  cropStatusByFrameId: {},
  includedPathSet: new Set(targetPaths),
  previewReady: true,
  targetPaths,
});
const selectedFrameIds = ['negative-lab-frame-1', 'negative-lab-frame-3'];
const frameScanMetrics = [
  {
    frameId: 'negative-lab-frame-1',
    metrics: buildNegativeLabScanMetricsV1({
      imageHeight: 24,
      imageWidth: 24,
      pixels: buildPixels(0.64, 0.3),
    }),
    sourcePath: targetPaths[0],
  },
  {
    frameId: 'negative-lab-frame-3',
    metrics: buildNegativeLabScanMetricsV1({
      imageHeight: 24,
      imageWidth: 24,
      pixels: buildPixels(0.26, 0.34),
    }),
    sourcePath: targetPaths[2],
  },
];
const plan = buildNegativeLabRollNormalizationPlan({
  anchorFrameIds: ['negative-lab-frame-1'],
  baselineExposure: 0,
  frameHealthReport,
  frameScanMetrics,
  mode: 'density_and_balance',
  preserveCreativeAdjustments: true,
  selectedFrameIds,
});
const routePlan = buildNegativeLabPlanRollNormalizationRouteResult({
  activePathIndex: 0,
  anchorFrameIds: ['negative-lab-frame-1'],
  baseFogConfidence: 0.91,
  frameScanMetrics,
  includedPaths: targetPaths,
  mode: 'density_and_balance',
  preserveCreativeAdjustments: true,
  previewReady: true,
  selectedFrameIds,
  targetPaths,
});

if (plan.affectedFrameIds.join(',') !== selectedFrameIds.join(',')) {
  throw new Error(`Expected selected frames to be affected: ${JSON.stringify(plan.affectedFrameIds)}.`);
}
if (!plan.unaffectedFrameIds.includes('negative-lab-frame-2')) {
  throw new Error(`Expected unselected frame to remain unaffected: ${JSON.stringify(plan.unaffectedFrameIds)}.`);
}
if (plan.positiveVariantIds.length !== selectedFrameIds.length) {
  throw new Error('Roll normalization apply preview must identify affected positive variants.');
}
if (routePlan.affectedFrameIds.join(',') !== plan.affectedFrameIds.join(',')) {
  throw new Error('Roll normalization app-server route diverged from planner.');
}

const transcript = transcriptSchema.parse({
  affectedFrameIds: plan.affectedFrameIds,
  exposureOverrideCount: plan.exposureOverrides.overrides.length,
  positiveVariantIds: plan.positiveVariantIds,
  routeAffectedFrameIds: routePlan.affectedFrameIds,
  rgbOverrideCount: plan.rgbBalanceOverrides.overrides.length,
  suggestionCount: plan.autoDensitySuggestionRun?.frameSuggestions.length ?? 0,
  suggestionState: plan.autoDensitySuggestionRun?.state ?? 'missing',
  unaffectedFrameIds: plan.unaffectedFrameIds,
  warningCodes: plan.warningCodes,
});

console.log(JSON.stringify(transcript));
