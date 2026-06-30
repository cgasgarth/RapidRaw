#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import { z } from 'zod';

import {
  buildHdrDeghostConfidenceMapV1,
  detectHdrMotionMaskV1,
  summarizeHdrDeghostConfidenceMapV1,
} from '../../../packages/rawengine-schema/src/hdrDeghostRuntime.ts';
import { buildHdrRuntimeDryRunV1 } from '../../../packages/rawengine-schema/src/hdrRuntimePlan.ts';
import { ApprovalClass, RAW_ENGINE_SCHEMA_VERSION } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const REPORT_PATH = 'docs/validation/proofs/hdr/hdr-deghost-confidence-map-2026-06-20.json';
const GENERATED_AT = '2026-06-20T00:00:00.000Z';
const WIDTH = 64;
const HEIGHT = 40;
const MOTION_THRESHOLD = 0.2;

const reportSchema = z
  .object({
    confidenceMapHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    doesNotProve: z.array(z.enum(['real_raw_e2e', 'ui_overlay', 'final_blend_quality'])).min(1),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(2351),
    runtimeDryRunExposesConfidenceMap: z.literal(true),
    schemaVersion: z.literal(1),
    summary: z
      .object({
        averageConfidence: z.number().min(0).max(1),
        maxConfidence: z.number().min(0.95).max(1),
        motionCoverageRatio: z.number().min(0.01).max(0.5),
      })
      .strict(),
    validationMode: z.literal('synthetic_hdr_deghost_confidence_map'),
  })
  .strict();

const update = process.argv.includes('--update');
const frames = createFrames();
const deghostRequest = {
  frames,
  motionThreshold: MOTION_THRESHOLD,
  referenceSourceIndex: 1,
};
const motionMask = detectHdrMotionMaskV1(deghostRequest);
const confidenceMap = buildHdrDeghostConfidenceMapV1(deghostRequest);
const summary = summarizeHdrDeghostConfidenceMapV1(confidenceMap, motionMask);
const dryRun = buildHdrRuntimeDryRunV1({
  command: {
    actor: { id: 'agent_rawengine', kind: 'agent' },
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview HDR deghost confidence map artifact.',
      state: 'not_required',
    },
    commandId: 'command_hdr_deghost_confidence_map',
    commandType: 'computationalMerge.createHdr',
    correlationId: 'corr_hdr_deghost_confidence_map',
    dryRun: true,
    expectedGraphRevision: 'graph_hdr_deghost_confidence_map',
    parameters: {
      alignmentMode: 'none',
      bracketValidation: 'required',
      deghostConfidenceMapVisible: true,
      deghostRegionIntensityPercent: 85,
      deghosting: 'medium',
      maxPreviewDimensionPx: 1200,
      mergeStrategy: 'scene_linear_radiance',
      outputName: 'HDR Deghost Confidence Map',
      qualityPreference: 'balanced',
      sources: frames.map((frame, index) => ({
        colorSpaceHint: 'camera_rgb',
        exposureEv: index - 1,
        imageId: `img_hdr_deghost_confidence_${index}`,
        imagePath: `/synthetic/hdr/deghost-confidence-${index}.dng`,
        rawDefaultsApplied: true,
        role: 'hdr_bracket',
        sourceIndex: frame.sourceIndex,
      })),
      toneMapPreview: true,
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: { id: 'project_hdr_deghost_confidence', kind: 'project' },
  },
  frames: frames.map((frame, index) => ({
    contentHash: `sha256:hdr-deghost-confidence-source-${index}`,
    exposureEv: index - 1,
    graphRevision: 'graph_hdr_deghost_confidence_source',
    ...frame,
  })),
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_deghost_confidence_output',
  previewArtifactId: 'artifact_hdr_deghost_confidence_preview',
});

if (dryRun.motionConfidenceMap.length !== confidenceMap.length) {
  throw new Error('HDR runtime dry-run did not expose the deghost confidence map.');
}
if (!dryRun.provenance.deghostConfidenceMap.visible) {
  throw new Error('HDR runtime dry-run did not preserve confidence map visibility.');
}
if (dryRun.provenance.deghostRegionIntensityPercent !== 85) {
  throw new Error('HDR runtime dry-run did not preserve deghost region intensity.');
}
if (hashFloat64(renderWithIntensity(0)) === hashFloat64(renderWithIntensity(100))) {
  throw new Error('HDR deghost region intensity did not change rendered output.');
}

const report = reportSchema.parse({
  confidenceMapHash: hashFloat64(confidenceMap),
  doesNotProve: ['real_raw_e2e', 'ui_overlay', 'final_blend_quality'],
  generatedAt: GENERATED_AT,
  issue: 2351,
  runtimeDryRunExposesConfidenceMap: dryRun.motionConfidenceMap.length === confidenceMap.length,
  schemaVersion: 1,
  summary,
  validationMode: 'synthetic_hdr_deghost_confidence_map',
});
const reportJson = `${JSON.stringify(report, null, 2)}\n`;

if (update) {
  await Bun.write(REPORT_PATH, reportJson);
  console.log('hdr deghost confidence map updated');
  process.exit(0);
}

if (!existsSync(REPORT_PATH)) {
  throw new Error(`Missing ${REPORT_PATH}; run bun run check:hdr-deghost-confidence-map:update.`);
}

const expected = reportSchema.parse(await Bun.file(REPORT_PATH).json());
if (JSON.stringify(expected) !== JSON.stringify(report)) {
  throw new Error(`${REPORT_PATH} is stale; run bun run check:hdr-deghost-confidence-map:update.`);
}

console.log(`hdr deghost confidence map ok (${summary.motionCoverageRatio} coverage)`);

function createFrames(): Array<{ height: number; pixels: Float64Array; sourceIndex: number; width: number }> {
  const background = new Float64Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      background[y * WIDTH + x] = 0.08 + x / WIDTH + y / (HEIGHT * 2);
    }
  }

  return [8, 28, 48].map((objectX, sourceIndex) => {
    const pixels = new Float64Array(background);
    for (let y = 16; y < 26; y += 1) {
      for (let x = objectX; x < objectX + 8; x += 1) {
        pixels[y * WIDTH + x] = 1.25;
      }
    }
    return { height: HEIGHT, pixels, sourceIndex, width: WIDTH };
  });
}

function hashFloat64(pixels: Float64Array): string {
  return `sha256:${createHash('sha256').update(Buffer.from(pixels.buffer)).digest('hex')}`;
}

function renderWithIntensity(deghostRegionIntensityPercent: number): Float64Array {
  return buildHdrRuntimeDryRunV1({
    command: {
      actor: { id: 'agent_rawengine', kind: 'agent' },
      approval: {
        approvalClass: ApprovalClass.PreviewOnly,
        reason: 'Preview HDR deghost intensity output.',
        state: 'not_required',
      },
      commandId: `command_hdr_deghost_intensity_${deghostRegionIntensityPercent}`,
      commandType: 'computationalMerge.createHdr',
      correlationId: `corr_hdr_deghost_intensity_${deghostRegionIntensityPercent}`,
      dryRun: true,
      expectedGraphRevision: 'graph_hdr_deghost_intensity',
      parameters: {
        alignmentMode: 'none',
        bracketValidation: 'required',
        deghostConfidenceMapVisible: true,
        deghostRegionIntensityPercent,
        deghosting: 'medium',
        maxPreviewDimensionPx: 1200,
        mergeStrategy: 'scene_linear_radiance',
        outputName: `HDR Deghost ${deghostRegionIntensityPercent}`,
        qualityPreference: 'balanced',
        sources: frames.map((frame, index) => ({
          colorSpaceHint: 'camera_rgb',
          exposureEv: index - 1,
          imageId: `img_hdr_deghost_intensity_${deghostRegionIntensityPercent}_${index}`,
          imagePath: `/synthetic/hdr/deghost-intensity-${deghostRegionIntensityPercent}-${index}.dng`,
          rawDefaultsApplied: true,
          role: 'hdr_bracket',
          sourceIndex: frame.sourceIndex,
        })),
        toneMapPreview: true,
      },
      schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      target: { id: 'project_hdr_deghost_intensity', kind: 'project' },
    },
    frames: frames.map((frame, index) => ({
      contentHash: `sha256:hdr-deghost-intensity-source-${deghostRegionIntensityPercent}-${index}`,
      exposureEv: index - 1,
      graphRevision: 'graph_hdr_deghost_intensity_source',
      ...frame,
    })),
    motionThreshold: MOTION_THRESHOLD,
    outputArtifactId: `artifact_hdr_deghost_intensity_output_${deghostRegionIntensityPercent}`,
    previewArtifactId: `artifact_hdr_deghost_intensity_preview_${deghostRegionIntensityPercent}`,
  }).mergedPixels;
}
