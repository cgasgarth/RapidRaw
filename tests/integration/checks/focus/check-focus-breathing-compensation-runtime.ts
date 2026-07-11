#!/usr/bin/env bun

import { focusStackNativeInputPlanSchema } from '../../../../src/schemas/focus-stack/focusStackNativePlanSchemas.ts';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const identity = transform(0, 1, 0, 0, 0);
const breathing = transform(1, 1.012, 0.25, 1.125, -0.625);
const source = (sourceIndex: number) => ({
  activeArea: { height: 72, width: 96, x: 0, y: 0 },
  aperture: null,
  calibrationIdentity: 'rendered_srgb_declared_v1',
  cameraMake: 'rendered',
  cameraModel: 'rendered_rgb',
  clippingRatio: 0,
  contentHash: `blake3:${sourceIndex}`,
  effectiveCalibrationIdentity: 'rendered_srgb_declared_v1',
  exposureEv: null,
  finitePixelRatio: 1,
  focalLengthMm: null,
  focusDistanceMm: null,
  graphRevision: 'graph-v1',
  height: 72,
  invalidBorderRatio: 0,
  iso: null,
  lensModel: null,
  lumaNoiseEstimate: 0.001,
  orientation: 'Normal',
  pathHandle: `source-${sourceIndex}`,
  proxyHash: `blake3:proxy-${sourceIndex}`,
  referenceScore: { clippingInvalidRatio: 0, lumaNoiseEstimate: 0.001, orderDelta: sourceIndex },
  sceneLinearRenderIdentity: 'rendered_rgb_scene_linear_v1',
  sourceIndex,
  sourceKind: 'rendered_rgb_source' as const,
  warnings: [],
  width: 96,
});

const result = focusStackNativeInputPlanSchema.parse({
  accepted: true,
  acceptedDryRunPlanHash: 'blake3:alignment-plan',
  acceptedDryRunPlanId: 'focus_stack_input_plan_alignment',
  alignmentAlgorithmId: 'focus_similarity_gradient_v1',
  alignmentPolicyId: 'focus_similarity_bounds_v1',
  blockCodes: [],
  commonGeometry: { height: 72, width: 96, x: 0, y: 0 },
  commonOverlap: { height: 69, width: 92, x: 2, y: 1 },
  coordinateConvention: 'full_resolution_active_area_pixel_centers',
  effectiveCalibrationIdentity: 'rendered_srgb_declared_v1',
  focusOrderSource: 'user_selection',
  inputPlanHash: 'blake3:intake-plan',
  interpolationPolicyId: 'focus_inverse_bicubic_transparent_v1',
  policyId: 'focus_stack_intake_policy_v1',
  previews: [preview(0, false), preview(1, true)],
  proxyAlgorithmId: 'focus_luma_proxy_v1',
  referenceSourceIndex: 0,
  schemaVersion: 1,
  settings: {
    commonCropIdentity: 'common:uncropped',
    lensCorrectionIdentity: 'native_lens_policy_v1',
    neutralRawState: true,
    orientationIdentity: 'common:decoded_orientation',
  },
  sources: [source(0), source(1)],
  transforms: [identity, breathing],
  warningCodes: [],
});

if (!result.previews[1]?.compensationApplied)
  throw new Error('Non-identity sampled warp must mark compensation applied.');
if (result.transforms[1]?.scale !== 1.012) throw new Error('Breathing scale was not preserved by the UI schema.');
if (result.commonOverlap === null) throw new Error('Accepted alignment must expose a valid common overlap.');

let rejectedReceiptOnly = false;
try {
  focusStackNativeInputPlanSchema.parse({ ...result, previews: [preview(0, false), preview(1, false)] });
} catch {
  rejectedReceiptOnly = true;
}
if (!rejectedReceiptOnly) throw new Error('Schema accepted receipt-only breathing compensation.');

console.log('Focus breathing compensation schema/runtime bridge ok');

function transform(
  sourceIndex: number,
  scale: number,
  rotationDegrees: number,
  translationXPx: number,
  translationYPx: number,
) {
  return {
    centerXPx: 47.5,
    centerYPx: 35.5,
    sourceCenterXPx: 47.5,
    sourceCenterYPx: 35.5,
    referenceCenterXPx: 47.5,
    referenceCenterYPx: 35.5,
    confidence: 0.96,
    cropLossRatio: sourceIndex === 0 ? 0 : 0.03,
    exposureNormalization: {
      fitWithinBounds: true,
      logResidual: 0.01,
      metadataDeltaEv: null,
      sampleCoverage: 0.82,
      scalar: 1,
    },
    forwardMatrix: [scale, 0, translationXPx, 0, scale, translationYPx, 0, 0, 1],
    inlierRatio: 0.91,
    inverseMatrix: [1 / scale, 0, -translationXPx, 0, 1 / scale, -translationYPx, 0, 0, 1],
    overlapRatio: sourceIndex === 0 ? 1 : 0.97,
    p50ResidualPx: 0.08,
    p95ResidualPx: 0.21,
    reasonCodes: [],
    rotationDegrees,
    scale,
    sourceIndex,
    status: 'accepted' as const,
    translationXPx,
    translationYPx,
    validDomain: [
      { x: 0, y: 0 },
      { x: 95, y: 0 },
      { x: 95, y: 71 },
      { x: 0, y: 71 },
    ],
  };
}

function preview(sourceIndex: number, compensationApplied: boolean) {
  return {
    compensationApplied,
    differenceDataUrl: png,
    height: 69,
    overlayDataUrl: png,
    previewHash: `blake3:preview-${sourceIndex}`,
    referenceDataUrl: png,
    sourceIndex,
    width: 92,
  };
}
