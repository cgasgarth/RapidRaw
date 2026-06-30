#!/usr/bin/env bun

import { deriveArtifactInvalidationReasons } from '../../../../packages/rawengine-schema/src/derivedArtifactInvalidation.ts';
import {
  applyHdrRuntimePlanV1,
  buildHdrRuntimeDryRunV1,
} from '../../../../packages/rawengine-schema/src/hdr/hdrRuntimePlan.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const WIDTH = 64;
const HEIGHT = 48;
const SENSOR_WHITE_RADIANCE = 1;
const CLIP_THRESHOLD = 0.99;
const MOTION_THRESHOLD = 0.03;
const SEARCH_RADIUS_PX = 5;
const BRACKETS = [
  { exposureEv: -2, shiftX: 2, shiftY: -1, sourceIndex: 0 },
  { exposureEv: 0, shiftX: 0, shiftY: 0, sourceIndex: 1 },
  { exposureEv: 2, shiftX: -3, shiftY: 2, sourceIndex: 2 },
];

const scene = createSyntheticRadianceScene(WIDTH, HEIGHT);
const frames = BRACKETS.map((bracket) => ({
  contentHash: `sha256:hdr-runtime-source-${bracket.sourceIndex}`,
  exposureEv: bracket.exposureEv,
  graphRevision: 'graph_rev_hdr_runtime_source',
  height: HEIGHT,
  pixels: shiftImage(renderBracket(scene, bracket.exposureEv), WIDTH, HEIGHT, bracket.shiftX, bracket.shiftY),
  sourceIndex: bracket.sourceIndex,
  width: WIDTH,
}));

const dryRunCommand = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.PreviewOnly,
    reason: 'HDR runtime smoke validates non-mutating dry-run rendering.',
    state: 'not_required',
  },
  commandId: 'command_hdr_runtime_plan_smoke',
  commandType: 'computationalMerge.createHdr',
  correlationId: 'corr_hdr_runtime_plan_smoke',
  dryRun: true,
  expectedGraphRevision: 'graph_rev_hdr_runtime',
  parameters: {
    alignmentMode: 'translation',
    bracketValidation: 'required',
    deghosting: 'medium',
    maxPreviewDimensionPx: 1200,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Synthetic Runtime HDR',
    qualityPreference: 'balanced',
    sources: BRACKETS.map((bracket) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: bracket.exposureEv,
      imageId: `img_hdr_runtime_${bracket.sourceIndex}`,
      imagePath: `/synthetic/hdr/runtime-${bracket.sourceIndex}.dng`,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex: bracket.sourceIndex,
    })),
    toneMapPreview: true,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_hdr_runtime', kind: 'project' },
};

const dryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: dryRunCommand,
  frames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_output',
  previewArtifactId: 'artifact_hdr_runtime_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
  syntheticScenePixels: scene,
});
const unalignedDryRunCommand = {
  ...dryRunCommand,
  commandId: 'command_hdr_runtime_plan_unaligned_smoke',
  correlationId: 'corr_hdr_runtime_plan_unaligned_smoke',
  parameters: {
    ...dryRunCommand.parameters,
    alignmentMode: 'none',
    deghosting: 'off',
  },
};
const unalignedDryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: unalignedDryRunCommand,
  frames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_unaligned_output',
  previewArtifactId: 'artifact_hdr_runtime_unaligned_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
  syntheticScenePixels: scene,
});

const applyCommand = {
  ...dryRunCommand,
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'HDR runtime smoke applies accepted dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_hdr_runtime_apply_smoke',
  correlationId: 'corr_hdr_runtime_apply_smoke',
  dryRun: false,
  parameters: {
    ...dryRunCommand.parameters,
    acceptedDryRunPlanHash: `sha256:${dryRun.dryRunResult.mergePlan.planId}`,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
};

const applied = applyHdrRuntimePlanV1({
  clipThreshold: CLIP_THRESHOLD,
  command: applyCommand,
  frames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_output',
  previewArtifactId: 'artifact_hdr_runtime_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
  syntheticScenePixels: scene,
});

const narrowExposureValues = [-0.2, 0, 0.2];
const narrowBracketSources = dryRunCommand.parameters.sources.map((source, index) => ({
  ...source,
  exposureEv: narrowExposureValues[index] ?? 0,
}));
const narrowBracketFrames = frames.map((frame, index) => ({
  ...frame,
  exposureEv: narrowExposureValues[index] ?? 0,
}));
const narrowRequiredDryRunCommand = {
  ...dryRunCommand,
  commandId: 'command_hdr_runtime_required_narrow_bracket',
  correlationId: 'corr_hdr_runtime_required_narrow_bracket',
  parameters: {
    ...dryRunCommand.parameters,
    sources: narrowBracketSources,
  },
};
const blockedRequiredDryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: narrowRequiredDryRunCommand,
  frames: narrowBracketFrames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_required_narrow_output',
  previewArtifactId: 'artifact_hdr_runtime_required_narrow_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
});
assertEqual(blockedRequiredDryRun.dryRunResult.mutates, false, 'blocked required dry-run mutates');
assertEqual(
  blockedRequiredDryRun.provenance.derivedSourceReview.reviewStatus,
  'blocked',
  'blocked required review status',
);
assertIncludes(
  blockedRequiredDryRun.provenance.derivedSourceReview.blockCodes,
  'not_a_bracket',
  'blocked required bracket code',
);

const narrowRequiredApplyCommand = {
  ...applyCommand,
  commandId: 'command_hdr_runtime_required_narrow_apply',
  correlationId: 'corr_hdr_runtime_required_narrow_apply',
  parameters: {
    ...applyCommand.parameters,
    sources: narrowBracketSources,
  },
};
assertThrows(
  () =>
    applyHdrRuntimePlanV1({
      clipThreshold: CLIP_THRESHOLD,
      command: narrowRequiredApplyCommand,
      frames: narrowBracketFrames,
      motionThreshold: MOTION_THRESHOLD,
      outputArtifactId: 'artifact_hdr_runtime_required_narrow_apply_output',
      previewArtifactId: 'artifact_hdr_runtime_required_narrow_apply_preview',
      searchRadiusPx: SEARCH_RADIUS_PX,
      sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
    }),
  'required apply bracket policy',
);

const warnDryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: {
    ...narrowRequiredDryRunCommand,
    commandId: 'command_hdr_runtime_warn_narrow_bracket',
    correlationId: 'corr_hdr_runtime_warn_narrow_bracket',
    parameters: {
      ...narrowRequiredDryRunCommand.parameters,
      bracketValidation: 'warn',
    },
  },
  frames: narrowBracketFrames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_warn_narrow_output',
  previewArtifactId: 'artifact_hdr_runtime_warn_narrow_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
});
assertIncludes(warnDryRun.dryRunResult.warnings, 'bracket_validation_block:not_a_bracket', 'warn bracket policy');

const disabledDryRun = buildHdrRuntimeDryRunV1({
  clipThreshold: CLIP_THRESHOLD,
  command: {
    ...narrowRequiredDryRunCommand,
    commandId: 'command_hdr_runtime_disabled_narrow_bracket',
    correlationId: 'corr_hdr_runtime_disabled_narrow_bracket',
    parameters: {
      ...narrowRequiredDryRunCommand.parameters,
      bracketValidation: 'disabled',
    },
  },
  frames: narrowBracketFrames,
  motionThreshold: MOTION_THRESHOLD,
  outputArtifactId: 'artifact_hdr_runtime_disabled_narrow_output',
  previewArtifactId: 'artifact_hdr_runtime_disabled_narrow_preview',
  searchRadiusPx: SEARCH_RADIUS_PX,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
});
assertIncludes(disabledDryRun.dryRunResult.warnings, 'bracket_validation_disabled', 'disabled bracket policy');

assertEqual(dryRun.provenance.alignmentMode, 'translation', 'dry-run alignment mode');
assertEqual(dryRun.provenance.deghosting, 'medium', 'dry-run deghosting');
assertEqual(dryRun.provenance.qualityMetrics.maxReconstructionMae, 0.015, 'max reconstruction mae');
assertEqual(applied.provenance.runtimeStatus, 'apply_rendered', 'apply runtime status');
assertEqual(applied.provenance.acceptedDryRunPlanId, dryRun.dryRunResult.mergePlan.planId, 'accepted dry-run plan id');
const [outputArtifact] = applied.mutationResult.outputArtifacts;
if (outputArtifact?.contentHash === undefined) {
  throw new Error('Expected HDR output artifact to include rendered content hash.');
}
assertEqual(applied.sidecarArtifact.family, 'hdr', 'sidecar artifact family');
assertEqual(applied.sidecarArtifact.outputArtifact.storage, 'sidecar_artifact', 'sidecar artifact output storage');
assertEqual(applied.sidecarArtifact.engine.capabilityLevel, 'runtime_apply_capable', 'sidecar artifact capability');
assertEqual(
  applied.sidecarArtifact.editableDerivedAssetId,
  'derived_command_hdr_runtime_apply_smoke',
  'editable asset id',
);
assertEqual(applied.sidecarArtifact.sourceImageRefs.length, BRACKETS.length, 'sidecar source refs');
assertEqual(applied.sidecarArtifact.sourceState.length, BRACKETS.length, 'sidecar source state');
assertEqual(applied.sidecarArtifact.staleState.state, 'current', 'sidecar current state');

const currentArtifactState = {
  outputContentHash: applied.sidecarArtifact.outputArtifact.contentHash,
  sourceState: applied.sidecarArtifact.sourceState,
};
const unchangedArtifactReasons = deriveArtifactInvalidationReasons(applied.sidecarArtifact, currentArtifactState);
assertEqual(unchangedArtifactReasons.length, 0, 'unchanged sidecar invalidation reasons');
const sourceChangedReasons = deriveArtifactInvalidationReasons(applied.sidecarArtifact, {
  ...currentArtifactState,
  sourceState: [
    { ...currentArtifactState.sourceState[0], contentHash: 'sha256:changed-hdr-source' },
    ...currentArtifactState.sourceState.slice(1),
  ],
});
assertIncludes(sourceChangedReasons, 'source_content_hash_changed', 'source hash invalidation');
const outputChangedReasons = deriveArtifactInvalidationReasons(applied.sidecarArtifact, {
  ...currentArtifactState,
  outputContentHash: 'sha256:changed-hdr-output',
});
assertIncludes(outputChangedReasons, 'output_artifact_changed', 'output artifact invalidation');

if (dryRun.provenance.alignmentConfidence < 0.99) {
  throw new Error(`Expected alignment confidence >= 0.99, got ${dryRun.provenance.alignmentConfidence}.`);
}

const expectedTransforms = new Map(
  BRACKETS.map((bracket) => [bracket.sourceIndex, { x: -bracket.shiftX, y: -bracket.shiftY }]),
);
for (const transform of dryRun.provenance.alignmentTransforms) {
  const expected = expectedTransforms.get(transform.sourceIndex);
  if (expected === undefined) throw new Error(`Missing expected transform for source ${transform.sourceIndex}.`);
  assertEqual(transform.translationPx.x, expected.x, `source ${transform.sourceIndex} translation x`);
  assertEqual(transform.translationPx.y, expected.y, `source ${transform.sourceIndex} translation y`);
}

if (dryRun.provenance.motionCoverageRatio <= 0) {
  throw new Error('Expected moving-subject fixture to produce a non-empty deghost mask.');
}
if (dryRun.provenance.qualityMetrics.motionPixelCount <= 0) {
  throw new Error('Expected HDR quality metrics to record motion pixels.');
}
if (dryRun.provenance.qualityMetrics.reconstructionMae === undefined) {
  throw new Error('Expected HDR synthetic quality metrics to include reconstruction MAE.');
}

if (applied.mergedPixels.length !== WIDTH * HEIGHT) {
  throw new Error('Expected applied HDR runtime output dimensions to match fixture.');
}

const alignedMae = measureCentralRegionMae(scene, applied.mergedPixels, WIDTH, HEIGHT, 6);
const unalignedMae = measureCentralRegionMae(scene, unalignedDryRun.mergedPixels, WIDTH, HEIGHT, 6);
if (alignedMae >= unalignedMae * 0.6) {
  throw new Error(`Expected aligned HDR MAE ${alignedMae} to improve over unaligned ${unalignedMae}.`);
}

console.log(
  JSON.stringify(
    {
      acceptedDryRunPlanId: applied.provenance.acceptedDryRunPlanId,
      alignmentConfidence: dryRun.provenance.alignmentConfidence,
      alignedMae,
      fixture: 'synthetic_hdr_runtime_plan_v1',
      motionCoverageRatio: dryRun.provenance.motionCoverageRatio,
      outputArtifactContentHash: outputArtifact.contentHash,
      outputSha256: new Bun.CryptoHasher('sha256').update(new Uint8Array(applied.mergedPixels.buffer)).digest('hex'),
      qualityMetrics: dryRun.provenance.qualityMetrics,
      unalignedMae,
    },
    null,
    2,
  ),
);

function createSyntheticRadianceScene(width, height) {
  const pixels = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.03 + (x / (width - 1)) * 0.11;
      const windowHighlight = isInsideRectangle(x, y, 39, 8, 18, 15) ? 0.07 : 0;
      const movingSubject = isInsideRectangle(x, y, 25, 20, 9, 10) ? 0.18 : 0;
      pixels[getPixelIndex(x, y, width)] = gradient + windowHighlight + movingSubject;
    }
  }
  return pixels;
}

function renderBracket(scene, exposureEv) {
  const exposureScale = 2 ** exposureEv;
  const pixels = new Float64Array(scene.length);
  for (let index = 0; index < scene.length; index += 1) {
    pixels[index] = Math.min(1, ((scene[index] ?? 0) * exposureScale) / SENSOR_WHITE_RADIANCE);
  }
  return pixels;
}

function shiftImage(image, width, height, shiftX, shiftY) {
  const shifted = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height) {
        shifted[getPixelIndex(x, y, width)] = image[getPixelIndex(sourceX, sourceY, width)] ?? 0;
      }
    }
  }
  return shifted;
}

function isInsideRectangle(x, y, left, top, width, height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}

function measureCentralRegionMae(expected, actual, width, height, insetPx) {
  let absoluteError = 0;
  let count = 0;
  for (let y = insetPx; y < height - insetPx; y += 1) {
    for (let x = insetPx; x < width - insetPx; x += 1) {
      const index = getPixelIndex(x, y, width);
      absoluteError += Math.abs((expected[index] ?? 0) - (actual[index] ?? 0));
      count += 1;
    }
  }
  return Math.round((absoluteError / count) * 1_000_000) / 1_000_000;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}.`);
  }
}

function assertIncludes(values, expectedValue, label) {
  if (!values.includes(expectedValue)) {
    throw new Error(`${label}: expected ${expectedValue}.`);
  }
}

function assertThrows(callback, label) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`${label}: expected failure.`);
}
