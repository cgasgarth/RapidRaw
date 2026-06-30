#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  ApprovalClass,
  computationalMergeCommandEnvelopeV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  applySuperResolutionRuntimePlanV1,
  buildSuperResolutionRuntimeDryRunV1,
} from '../../../packages/rawengine-schema/src/superResolutionRuntimePlan.ts';
import {
  applySuperResolutionArtifactToSidecar,
  buildSuperResolutionArtifactSidecarRecordV1,
  classifySuperResolutionArtifactStaleState,
  markSuperResolutionArtifactStaleState,
  readSuperResolutionArtifactFromSidecar,
} from '../../../packages/rawengine-schema/src/superResolutionSidecarProvenance.ts';

const REPORT_PATH = 'docs/validation/proofs/super-resolution/super-resolution-sidecar-provenance-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const SCALE = 2;
const LOW_WIDTH = 12;
const LOW_HEIGHT = 10;
const HIGH_WIDTH = LOW_WIDTH * SCALE;
const HIGH_HEIGHT = LOW_HEIGHT * SCALE;
const CREATED_AT = '2026-06-20T15:00:00.000Z';

const reportSchema = z
  .object({
    doesNotProve: z.array(z.enum(['filesystem_sidecar_write', 'ui_reload_badge', 'real_raw_e2e'])).min(1),
    issue: z.literal(2359),
    outputArtifactHash: z.string().trim().min(1),
    provenanceRecordHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    reloadedArtifactId: z.string().trim().min(1),
    runtimeApplySidecarRecord: z.literal(true),
    sidecarHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    staleReasons: z.array(
      z.enum([
        'alignment_settings_changed',
        'detail_policy_changed',
        'engine_version_changed',
        'output_artifact_changed',
        'reconstruction_mode_changed',
        'scale_changed',
        'source_content_hash_changed',
        'source_graph_revision_changed',
        'source_set_changed',
      ]),
    ),
    validationMode: z.literal('sr_sidecar_provenance_roundtrip'),
  })
  .strict();

const truth = createTruth();
const frames = [
  { shiftX: 0, shiftY: 0, sourceIndex: 0 },
  { shiftX: 1, shiftY: 0, sourceIndex: 1 },
  { shiftX: 0, shiftY: 1, sourceIndex: 2 },
  { shiftX: 1, shiftY: 1, sourceIndex: 3 },
].map((frame) => ({
  contentHash: `sha256:sr-sidecar-source-${frame.sourceIndex}`,
  graphRevision: 'graph_rev_sr_sidecar_source',
  height: LOW_HEIGHT,
  pixels: downsample(truth, frame.shiftX, frame.shiftY),
  shiftX: frame.shiftX,
  shiftY: frame.shiftY,
  sourceIndex: frame.sourceIndex,
  width: LOW_WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'Super-resolution sidecar provenance check validates dry-run planning.',
    state: 'not_required',
  },
  commandId: 'command_sr_sidecar_provenance',
  commandType: 'computationalMerge.createSuperResolution',
  correlationId: 'corr_sr_sidecar_provenance',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_sr_sidecar',
  parameters: {
    alignmentMode: 'translation',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 1200,
    mode: 'multi_image',
    outputName: 'Synthetic Sidecar Provenance SR',
    outputScale: SCALE,
    qualityPreference: 'best',
    sources: frames.map((frame) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: 0,
      imageId: `img_sr_sidecar_${frame.sourceIndex}`,
      imagePath: `/synthetic/sr/sidecar-${frame.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'sr_frame',
      sourceIndex: frame.sourceIndex,
    })),
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_sr_sidecar', kind: 'project' },
};

const dryRun = buildSuperResolutionRuntimeDryRunV1({
  command: dryRunCommand,
  confidenceMapArtifactId: 'artifact_sr_sidecar_confidence',
  frames,
  outputArtifactId: 'artifact_sr_sidecar_output',
  previewArtifactId: 'artifact_sr_sidecar_preview',
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'Super-resolution sidecar provenance check applies accepted plan.',
    state: 'approved',
  },
  commandId: 'command_sr_sidecar_provenance_apply',
  correlationId: 'corr_sr_sidecar_provenance_apply',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applySuperResolutionRuntimePlanV1({
  command: applyCommand,
  confidenceMapArtifactId: 'artifact_sr_sidecar_confidence',
  frames,
  outputArtifactId: 'artifact_sr_sidecar_output',
  previewArtifactId: 'artifact_sr_sidecar_preview',
});

if (applied.sidecarArtifact.outputArtifact.artifactId !== 'artifact_sr_sidecar_output') {
  throw new Error('Runtime apply did not return the SR output sidecar artifact record.');
}
const parsedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse(applyCommand);
if (parsedApplyCommand.commandType !== 'computationalMerge.createSuperResolution') {
  throw new Error('Expected a parsed super-resolution apply command.');
}

const outputArtifact = applied.mutationResult.outputArtifacts.find((artifact) => artifact.kind === 'merge_output');
if (outputArtifact === undefined) throw new Error('Expected runtime apply to produce a merge output artifact.');

const artifact = buildSuperResolutionArtifactSidecarRecordV1({
  command: parsedApplyCommand,
  createdAt: CREATED_AT,
  outputArtifact,
  previewArtifacts: [],
  provenance: applied.provenance,
});

const sidecar = applySuperResolutionArtifactToSidecar({ rating: 0, schemaVersion: 1, version: 1 }, artifact);
const reloaded = readSuperResolutionArtifactFromSidecar(sidecar, artifact.artifactId);
if (reloaded === undefined) throw new Error('SR artifact record did not roundtrip through sidecar.');
if (reloaded.outputArtifact.contentHash !== artifact.outputArtifact.contentHash) {
  throw new Error('SR artifact output hash changed after sidecar reload.');
}

const currentState = {
  detailPolicy: artifact.detailPolicy,
  engine: artifact.engine,
  outputContentHash: artifact.outputArtifact.contentHash,
  reconstructionMode: artifact.reconstructionMode,
  requestedAlignmentMode: artifact.requestedAlignmentMode,
  requestedOutputScale: artifact.requestedOutputScale,
  resolvedAlignmentMode: artifact.resolvedAlignmentMode,
  sourceState: artifact.sourceState,
};
const unchangedState = classifySuperResolutionArtifactStaleState(artifact, currentState);
if (unchangedState.state !== 'current') throw new Error('Unchanged SR artifact provenance should remain current.');
const firstSourceState = artifact.sourceState[0];
if (firstSourceState === undefined) throw new Error('Expected at least one SR source state.');

const sourceHashState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  sourceState: [{ ...firstSourceState, contentHash: 'sha256:changed-source' }, ...artifact.sourceState.slice(1)],
});
const graphRevisionState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  sourceState: [{ ...firstSourceState, graphRevision: 'graph_rev_changed' }, ...artifact.sourceState.slice(1)],
});
const sourceSetState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  sourceState: artifact.sourceState.slice(1),
});
const outputState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  outputContentHash: 'sha256:changed-output',
});
const policyState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  detailPolicy: 'balanced',
});
const scaleState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  requestedOutputScale: 3,
});
const alignmentState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  resolvedAlignmentMode: 'homography',
});
const engineState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  engine: { ...artifact.engine, engineVersion: `${artifact.engine.engineVersion}-next` },
});
const reconstructionModeState = classifySuperResolutionArtifactStaleState(artifact, {
  ...currentState,
  reconstructionMode: artifact.reconstructionMode === 'model_detail' ? 'optical_flow' : 'model_detail',
});

const staleReasons = [
  sourceHashState,
  graphRevisionState,
  sourceSetState,
  outputState,
  policyState,
  scaleState,
  alignmentState,
  engineState,
  reconstructionModeState,
].flatMap((state) => state.invalidationReasons);
for (const expectedReason of [
  'source_content_hash_changed',
  'source_graph_revision_changed',
  'source_set_changed',
  'output_artifact_changed',
  'detail_policy_changed',
  'scale_changed',
  'alignment_settings_changed',
  'engine_version_changed',
  'reconstruction_mode_changed',
]) {
  if (!staleReasons.includes(expectedReason)) throw new Error(`Missing stale reason ${expectedReason}.`);
}

const staleArtifact = markSuperResolutionArtifactStaleState(
  artifact,
  {
    ...currentState,
    outputContentHash: 'sha256:changed-output',
  },
  CREATED_AT,
);
if (staleArtifact.staleState.state !== 'stale') throw new Error('SR stale marker did not persist stale state.');

const report = reportSchema.parse({
  doesNotProve: ['filesystem_sidecar_write', 'ui_reload_badge', 'real_raw_e2e'],
  issue: 2359,
  outputArtifactHash: outputArtifact.contentHash,
  provenanceRecordHash: hashJson(artifact),
  reloadedArtifactId: reloaded.artifactId,
  runtimeApplySidecarRecord: applied.sidecarArtifact.family === 'super_resolution',
  sidecarHash: hashJson(sidecar),
  staleReasons: [...new Set(staleReasons)],
  validationMode: 'sr_sidecar_provenance_roundtrip',
});

const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expected = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expected) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:sr-sidecar-provenance:update.`);
  }
}

console.log(`sr sidecar provenance ok (${report.staleReasons.length} stale reasons)`);

function createTruth(): Float32Array {
  const pixels = new Float32Array(HIGH_WIDTH * HIGH_HEIGHT);
  for (let y = 0; y < HIGH_HEIGHT; y += 1) {
    for (let x = 0; x < HIGH_WIDTH; x += 1) {
      pixels[y * HIGH_WIDTH + x] = Math.max(0, Math.min(1, (x / HIGH_WIDTH) * 0.45 + (y % 3) * 0.12));
    }
  }
  return pixels;
}

function downsample(truthPixels: Float32Array, shiftX: number, shiftY: number): Float32Array {
  const pixels = new Float32Array(LOW_WIDTH * LOW_HEIGHT);
  for (let y = 0; y < LOW_HEIGHT; y += 1) {
    for (let x = 0; x < LOW_WIDTH; x += 1) {
      pixels[y * LOW_WIDTH + x] = truthPixels[(y * SCALE + shiftY) * HIGH_WIDTH + x * SCALE + shiftX] ?? 0;
    }
  }
  return pixels;
}

function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
