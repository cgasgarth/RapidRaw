import { z } from 'zod';
import { focusStackFocusEvidenceSchema } from '../../../packages/rawengine-schema/src/focus-stack/focusStackFocusEvidence';

const rectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const scoreSchema = z
  .object({
    orderDelta: z.number().int().nonnegative(),
    clippingInvalidRatio: z.number().nonnegative(),
    lumaNoiseEstimate: z.number().nonnegative(),
  })
  .strict();
const sourceSchema = z
  .object({
    sourceIndex: z.number().int().nonnegative(),
    pathHandle: z.string().min(1),
    sourceKind: z.enum(['raw_sensor_source', 'rendered_rgb_source']),
    contentHash: z.string().startsWith('blake3:'),
    graphRevision: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    activeArea: rectSchema,
    orientation: z.string().min(1),
    cameraMake: z.string(),
    cameraModel: z.string(),
    lensModel: z.string().nullable(),
    focalLengthMm: z.number().positive().nullable(),
    aperture: z.number().positive().nullable(),
    focusDistanceMm: z.number().positive().nullable(),
    exposureEv: z.number().nullable(),
    iso: z.number().int().positive().nullable(),
    calibrationIdentity: z.string().min(1),
    effectiveCalibrationIdentity: z.string().min(1),
    sceneLinearRenderIdentity: z.string().min(1),
    clippingRatio: z.number().min(0).max(1),
    invalidBorderRatio: z.number().min(0).max(1),
    finitePixelRatio: z.number().min(0).max(1),
    lumaNoiseEstimate: z.number().nonnegative(),
    proxyHash: z.string().startsWith('blake3:'),
    referenceScore: scoreSchema,
    warnings: z.array(z.string()),
  })
  .strict();
const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const floatRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
const matrixSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const transformSchema = z
  .object({
    sourceIndex: z.number().int().nonnegative(),
    scale: z.number().positive(),
    rotationDegrees: z.number().finite(),
    translationXPx: z.number().finite(),
    translationYPx: z.number().finite(),
    centerXPx: z.number().finite(),
    centerYPx: z.number().finite(),
    sourceCenterXPx: z.number().finite(),
    sourceCenterYPx: z.number().finite(),
    referenceCenterXPx: z.number().finite(),
    referenceCenterYPx: z.number().finite(),
    forwardMatrix: matrixSchema,
    inverseMatrix: matrixSchema,
    validDomain: z.array(pointSchema).length(4),
    overlapRatio: z.number().min(0).max(1),
    cropLossRatio: z.number().min(0).max(1),
    inlierRatio: z.number().min(0).max(1),
    p50ResidualPx: z.number().nonnegative(),
    p95ResidualPx: z.number().nonnegative(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['accepted', 'excluded']),
    reasonCodes: z.array(z.string()),
    exposureNormalization: z
      .object({
        scalar: z.number().min(0.5).max(2),
        fitWithinBounds: z.boolean(),
        logResidual: z.number().nonnegative(),
        sampleCoverage: z.number().min(0).max(1),
        metadataDeltaEv: z.number().finite().nullable(),
      })
      .strict(),
  })
  .strict();
const previewSchema = z
  .object({
    sourceIndex: z.number().int().nonnegative(),
    referenceDataUrl: z.string().startsWith('data:image/png;base64,'),
    overlayDataUrl: z.string().startsWith('data:image/png;base64,'),
    differenceDataUrl: z.string().startsWith('data:image/png;base64,'),
    previewHash: z.string().startsWith('blake3:'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    compensationApplied: z.boolean(),
  })
  .strict();
const hashSchema = z.string().startsWith('blake3:');
const nativeBlendSchema = z
  .object({
    proofLevel: z.literal('native_measured_v1'),
    blendPolicyId: z.literal('focus_laplacian_owner_blend_v1'),
    pyramidPolicyId: z.literal('focus_binomial_pyramid_v1'),
    deterministicBackend: z.literal('cpu_f32_row_major_no_fast_math'),
    pyramidLevels: z.number().int().min(5).max(8),
    effectiveOwnerRadiusPx: z.number().int().min(0).max(8),
    ownerExpandedPixelRatio: z.number().min(0).max(1),
    previewDataUrl: z.string().startsWith('data:image/png;base64,'),
    contributionOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
    edgeOwnerOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
    fallbackOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
    haloRiskOverlayDataUrl: z.string().startsWith('data:image/png;base64,'),
    previewHash: hashSchema,
    contributionHash: hashSchema,
    edgeOwnerHash: hashSchema,
    fallbackHash: hashSchema,
    haloRiskHash: hashSchema,
    blendResultHash: hashSchema,
    fallbackRatio: z.number().min(0).max(1),
    lowConfidenceRatio: z.number().min(0).max(1),
    haloRiskRatio: z.number().min(0).max(1),
    edgeOwnerAmbiguityRatio: z.number().min(0).max(1),
    sourceContributions: z.array(
      z.object({ sourceIndex: z.number().int().nonnegative(), areaRatio: z.number().min(0).max(1) }).strict(),
    ),
    retouchSeed: z
      .object({
        contentHash: hashSchema,
        regions: z.array(
          z
            .object({
              x: z.number().int().nonnegative(),
              y: z.number().int().nonnegative(),
              width: z.number().int().positive(),
              height: z.number().int().positive(),
              maskHash: hashSchema,
              currentOwnerSource: z.number().int().nonnegative(),
              alternateSources: z.array(z.number().int().nonnegative()),
              reasonCodes: z.array(
                z.enum(['low_margin', 'occlusion_risk', 'alignment_risk', 'invalid_owner', 'halo_overshoot']),
              ),
              confidence: z.number().min(0).max(1),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export const focusStackNativeInputPlanSchema = z
  .object({
    accepted: z.boolean(),
    acceptedDryRunPlanHash: z.string().startsWith('blake3:'),
    acceptedDryRunPlanId: z.string().min(1),
    schemaVersion: z.literal(1),
    policyId: z.literal('focus_stack_intake_policy_v1'),
    proxyAlgorithmId: z.literal('focus_luma_proxy_v1'),
    focusOrderSource: z.literal('user_selection'),
    coordinateConvention: z.literal('full_resolution_active_area_pixel_centers'),
    referenceSourceIndex: z.number().int().nonnegative(),
    commonGeometry: rectSchema,
    effectiveCalibrationIdentity: z.string().min(1),
    settings: z
      .object({
        commonCropIdentity: z.string(),
        lensCorrectionIdentity: z.string(),
        neutralRawState: z.boolean(),
        orientationIdentity: z.string(),
        haloSuppressionStrengthPercent: z.number().int().min(0).max(100),
      })
      .strict(),
    sources: z.array(sourceSchema).min(2).max(128),
    warningCodes: z.array(z.string()),
    blockCodes: z.array(z.string()),
    inputPlanHash: z.string().startsWith('blake3:'),
    alignmentAlgorithmId: z.literal('focus_similarity_gradient_v1'),
    alignmentPolicyId: z.literal('focus_similarity_bounds_v1'),
    interpolationPolicyId: z.literal('focus_inverse_bicubic_transparent_v1'),
    commonOverlap: floatRectSchema.nullable(),
    transforms: z.array(transformSchema).min(2).max(128),
    previews: z.array(previewSchema).max(128),
    focusEvidence: focusStackFocusEvidenceSchema.nullable(),
    nativeBlend: nativeBlendSchema.nullable(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.accepted === plan.blockCodes.length > 0)
      context.addIssue({ code: 'custom', message: 'accepted must match blockCodes' });
    if (plan.referenceSourceIndex >= plan.sources.length)
      context.addIssue({ code: 'custom', message: 'referenceSourceIndex is out of range' });
    const sourceIndexes = new Set(plan.sources.map((source) => source.sourceIndex));
    if (plan.transforms.some((transform) => !sourceIndexes.has(transform.sourceIndex)))
      context.addIssue({ code: 'custom', message: 'transform sourceIndex is not present in sources' });
    if (plan.accepted && (plan.commonOverlap === null || plan.previews.length < 2))
      context.addIssue({ code: 'custom', message: 'accepted alignment requires a common crop and real previews' });
    if (plan.accepted !== (plan.focusEvidence !== null))
      context.addIssue({ code: 'custom', message: 'accepted plans must carry measured focus evidence' });
    if (plan.accepted !== (plan.nativeBlend !== null))
      context.addIssue({ code: 'custom', message: 'accepted plans must carry a native blend result' });
    for (const preview of plan.previews) {
      const transform = plan.transforms.find((candidate) => candidate.sourceIndex === preview.sourceIndex);
      const nonIdentity =
        transform !== undefined &&
        (transform.scale !== 1 ||
          transform.rotationDegrees !== 0 ||
          transform.translationXPx !== 0 ||
          transform.translationYPx !== 0);
      if (preview.compensationApplied !== (transform?.status === 'accepted' && nonIdentity))
        context.addIssue({ code: 'custom', message: 'compensationApplied must reflect a sampled accepted transform' });
    }
  });

export type FocusStackNativeInputPlan = z.infer<typeof focusStackNativeInputPlanSchema>;
