#!/usr/bin/env bun

import { z } from 'zod';

import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';
import { buildNegativeLabPlanRollNormalizationRouteResult } from '../../../src/utils/negativeLabAppServerRoutes.ts';
import { buildNegativeLabRollNormalizationPlan } from '../../../src/utils/negativeLabRollNormalizationPlan.ts';

const transcriptSchema = z
  .object({
    affectedFrameIds: z.array(z.string().trim().min(1)),
    exposureOverrideCount: z.number().int().nonnegative(),
    positiveVariantIds: z.array(z.string().trim().min(1)),
    routeAffectedFrameIds: z.array(z.string().trim().min(1)),
    rgbOverrideCount: z.number().int().nonnegative(),
    unaffectedFrameIds: z.array(z.string().trim().min(1)),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

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
const plan = buildNegativeLabRollNormalizationPlan({
  anchorFrameIds: ['negative-lab-frame-1'],
  baselineExposure: 0,
  frameHealthReport,
  mode: 'density_and_balance',
  preserveCreativeAdjustments: true,
  selectedFrameIds,
});
const routePlan = buildNegativeLabPlanRollNormalizationRouteResult({
  activePathIndex: 0,
  anchorFrameIds: ['negative-lab-frame-1'],
  baseFogConfidence: 0.91,
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
  unaffectedFrameIds: plan.unaffectedFrameIds,
  warningCodes: plan.warningCodes,
});

console.log(JSON.stringify(transcript));
