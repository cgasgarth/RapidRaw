#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import {
  applyPanoramaRuntimePlanV1,
  buildPanoramaRuntimeArtifactV1,
} from '../../../packages/rawengine-schema/src/panoramaRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES } from '../../../scripts/lib/computational-proof-budgets.ts';

const REPORT_PATH = 'artifacts/validation/panorama-exposure-runtime-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const sourceFrames = [
  {
    contentHash: 'sha256:panorama-exposure-source-0',
    expectedOffsetX: 0,
    expectedOffsetY: 0,
    graphRevision: 'graph_rev_panorama_exposure_source',
    height: 64,
    sourceIndex: 0,
    width: 96,
  },
  {
    contentHash: 'sha256:panorama-exposure-source-1',
    expectedOffsetX: 48,
    expectedOffsetY: 0,
    graphRevision: 'graph_rev_panorama_exposure_source',
    height: 64,
    sourceIndex: 1,
    width: 96,
  },
];

const exposureNormalizationSchema = z
  .object({
    appliedGainCount: z.number().int().positive(),
    appliedLuminanceGains: z
      .array(z.object({ gain: z.number().positive(), sourceIndex: z.number().int().nonnegative() }).strict())
      .min(1),
    compensationStrengthPercent: z.number().int().min(1).max(100),
    mode: z.literal('scalar_overlap_luminance_gain_v1'),
    overlapMetrics: z
      .object({
        medianLogLuminanceDeltaAfter: z.number().nonnegative(),
        medianLogLuminanceDeltaBefore: z.number().positive(),
      })
      .strict(),
    support: z.literal('implemented_current_engine'),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            compensatedOutputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            exposureNormalization: exposureNormalizationSchema,
            noCompensationOutputHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            outputPixelCount: z.number().int().positive(),
          })
          .strict(),
      )
      .length(1),
    issue: z.literal(2295),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_exposure_runtime_apply'),
    validationStatus: z.literal('synthetic_runtime_apply_gate'),
  })
  .strict();

const noCompensation = runApply('none');
const compensated = runApply('auto');
const exposureNormalization = exposureNormalizationSchema.parse(
  buildPanoramaRuntimeArtifactV1({
    applyResult: compensated,
    command: commandFor('auto'),
    createdAt: '2026-06-20T00:00:00.000Z',
  }).exposureNormalization,
);

if (hashPixels(noCompensation.outputPixels) === hashPixels(compensated.outputPixels)) {
  throw new Error('Panorama exposure proof expected compensated pixels to differ from uncompensated output.');
}
if (
  exposureNormalization.overlapMetrics.medianLogLuminanceDeltaAfter >=
  exposureNormalization.overlapMetrics.medianLogLuminanceDeltaBefore
) {
  throw new Error('Panorama exposure proof expected compensation to reduce median overlap luminance delta.');
}

const report = reportSchema.parse({
  cases: [
    {
      compensatedOutputHash: hashPixels(compensated.outputPixels),
      exposureNormalization,
      noCompensationOutputHash: hashPixels(noCompensation.outputPixels),
      outputPixelCount: compensated.outputPixels.length / 3,
    },
  ],
  issue: 2295,
  schemaVersion: 1,
  validationMode: 'panorama_exposure_runtime_apply',
  validationStatus: 'synthetic_runtime_apply_gate',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, reportText);
  console.log(`panorama exposure runtime proof artifact wrote ${REPORT_PATH}`);
  process.exit(0);
}

console.log(`panorama exposure runtime proof ok (${report.cases.length} cases)`);

function runApply(exposureNormalization: 'none' | 'auto') {
  return applyPanoramaRuntimePlanV1({
    command: commandFor(exposureNormalization),
    connectedSourceIndices: [0, 1],
    outputArtifactId: `artifact_panorama_exposure_${exposureNormalization}`,
    previewArtifactId: `preview_panorama_exposure_${exposureNormalization}`,
    seed: 'rawengine-panorama-exposure-runtime-v1',
    sourceFrames,
  });
}

function commandFor(exposureNormalization: 'none' | 'auto') {
  return {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Panorama exposure runtime proof applies synthetic overlap compensation.',
      state: 'approved',
    },
    commandId: `command_panorama_exposure_${exposureNormalization}`,
    commandType: 'computationalMerge.createPanorama',
    correlationId: `corr_panorama_exposure_${exposureNormalization}`,
    dryRun: false,
    expectedGraphRevision: 'graph_rev_panorama_exposure',
    parameters: {
      acceptedDryRunPlanHash: `sha256:panorama-exposure-${exposureNormalization}`,
      acceptedDryRunPlanId: `panorama_plan_exposure_${exposureNormalization}`,
      boundaryMode: 'auto_crop',
      exposureNormalization,
      lensCorrectionPolicy: 'required_before_stitch',
      maxPreviewDimensionPx: 1200,
      memoryBudgetBytes: COMPUTATIONAL_PROOF_MEMORY_BUDGET_BYTES,
      outputName: 'Synthetic Exposure Panorama',
      projection: 'rectilinear',
      qualityPreference: 'balanced',
      sources: sourceFrames.map((frame) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: frame.sourceIndex === 0 ? 0 : 1,
        imageId: `img_panorama_exposure_${frame.sourceIndex}`,
        imagePath: `/synthetic/panorama/exposure-${frame.sourceIndex}.dng`,
        rawDefaultsApplied: true,
        role: 'panorama_tile',
        sourceIndex: frame.sourceIndex,
      })),
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_panorama_exposure', kind: 'project' },
  } as const;
}

function hashPixels(pixels: Uint8Array): string {
  return `sha256:${new Bun.CryptoHasher('sha256').update(pixels).digest('hex')}`;
}
