#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { estimatePanoramaLoRansacTranslationV1 } from '../../../packages/rawengine-schema/src/panoramaLocalOptimizationRansac.ts';
import {
  applyPanoramaRuntimePlanV1,
  buildPanoramaRuntimeArtifactV1,
} from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'docs/validation/panorama-lo-ransac-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const sourceFrames = [
  {
    contentHash: 'sha256:panorama-lo-ransac-source-0',
    expectedOffsetX: 0,
    expectedOffsetY: 0,
    graphRevision: 'graph_rev_panorama_lo_ransac_source',
    height: 48,
    sourceIndex: 0,
    width: 72,
  },
  {
    contentHash: 'sha256:panorama-lo-ransac-source-1',
    expectedOffsetX: 48,
    expectedOffsetY: 2,
    graphRevision: 'graph_rev_panorama_lo_ransac_source',
    height: 48,
    sourceIndex: 1,
    width: 72,
  },
];

const translationSuccessSchema = z
  .object({
    algorithmId: z.literal('synthetic_descriptor_translation_lo_ransac_v1'),
    deterministicTieBreak: z.literal('first_max_consensus_lowest_match_index'),
    evaluatedSeedModelCount: z.literal(6),
    inlierCount: z.literal(5),
    inlierTolerancePx: z.literal(0.85),
    kind: z.literal('success'),
    localOptimization: z
      .object({
        algorithmId: z.literal('deterministic_inlier_mean_refinement_v1'),
        improvedMeanInlierError: z.literal(true),
        iterationCount: z.literal(1),
        meanInlierErrorAfterPx: z.number().nonnegative(),
        meanInlierErrorBeforePx: z.number().positive(),
        refinedModel: z.object({ model: z.literal('translation'), x: z.literal(48), y: z.literal(2) }).strict(),
      })
      .strict(),
    matchCount: z.literal(6),
    maxInlierErrorPx: z.number().nonnegative(),
    seedModel: z
      .object({
        model: z.literal('translation'),
        seedMatchIndex: z.literal(0),
        x: z.literal(48.4),
        y: z.literal(2.2),
      })
      .strict(),
    spatialSupport: z.unknown().optional(),
  })
  .strict();
const artifactOptimizationSchema = z
  .object({
    algorithmId: z.literal('deterministic_inlier_mean_refinement_v1'),
    boundedIterationCount: z.number().int().positive(),
    deterministicTieBreak: z.literal('first_max_consensus_lowest_match_index'),
    refinedModelType: z.literal('translation_xy'),
    support: z.literal('synthetic_translation_metadata_only'),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            artifactLocalOptimization: artifactOptimizationSchema,
            estimate: translationSuccessSchema,
          })
          .strict(),
      )
      .length(1),
    issue: z.literal(2290),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_local_optimization_ransac'),
    validationStatus: z.literal('synthetic_runtime_metadata_gate'),
  })
  .strict();

const estimate = translationSuccessSchema.parse(
  estimatePanoramaLoRansacTranslationV1({
    inlierTolerancePx: 0.85,
    matches: [
      { descriptor: 'm0', left: [0, 0], right: [48.4, 2.2] },
      { descriptor: 'm1', left: [10, 4], right: [57.8, 5.8] },
      { descriptor: 'm2', left: [20, 8], right: [68.1, 10.1] },
      { descriptor: 'm3', left: [30, 12], right: [77.7, 13.9] },
      { descriptor: 'm4', left: [40, 16], right: [88, 18] },
      { descriptor: 'outlier', left: [8, 36], right: [61, 45] },
    ],
    minimumInliers: 4,
  }),
);

if (estimate.localOptimization.meanInlierErrorAfterPx >= estimate.localOptimization.meanInlierErrorBeforePx) {
  throw new Error('Panorama LO-RANSAC proof expected mean inlier error improvement.');
}

const applyCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Panorama LO-RANSAC proof applies synthetic runtime metadata.',
    state: 'approved',
  },
  commandId: 'command_panorama_lo_ransac',
  commandType: 'computationalMerge.createPanorama',
  correlationId: 'corr_panorama_lo_ransac',
  dryRun: false,
  expectedGraphRevision: 'graph_rev_panorama_lo_ransac',
  parameters: {
    acceptedDryRunPlanHash: 'sha256:panorama-lo-ransac',
    acceptedDryRunPlanId: 'panorama_plan_lo_ransac',
    boundaryMode: 'auto_crop',
    exposureNormalization: 'auto',
    lensCorrectionPolicy: 'required_before_stitch',
    maxPreviewDimensionPx: 1200,
    memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
    outputName: 'Synthetic LO-RANSAC Panorama',
    projection: 'rectilinear',
    qualityPreference: 'balanced',
    sources: sourceFrames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_panorama_lo_ransac_${frame.sourceIndex}`,
      imagePath: `/synthetic/panorama/lo-ransac-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'panorama_tile',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_panorama_lo_ransac', kind: 'project' },
} as const;
const applyResult = applyPanoramaRuntimePlanV1({
  command: applyCommand,
  connectedSourceIndices: [0, 1],
  outputArtifactId: 'artifact_panorama_lo_ransac',
  previewArtifactId: 'preview_panorama_lo_ransac',
  seed: 'rawengine-panorama-lo-ransac-v1',
  sourceFrames,
});
const artifactLocalOptimization = artifactOptimizationSchema.parse(
  buildPanoramaRuntimeArtifactV1({
    applyResult,
    command: applyCommand,
    createdAt: '2026-06-20T00:00:00.000Z',
  }).alignment.localOptimization,
);

const report = reportSchema.parse({
  cases: [{ artifactLocalOptimization, estimate }],
  issue: 2290,
  schemaVersion: 1,
  validationMode: 'panorama_local_optimization_ransac',
  validationStatus: 'synthetic_runtime_metadata_gate',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-lo-ransac-proof:update.`);
  }
}

console.log(`panorama lo-ransac proof ok (${report.cases.length} cases)`);
