import { z } from 'zod';
import {
  hdrMergeWarningCodeV1Schema,
  hdrRuntimeSidecarReceiptV1Schema,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';

export const hdrMergeAlignmentModeSchema = z.enum(['auto', 'translation', 'homography', 'optical_flow', 'none']);
export const hdrMergeBracketValidationSchema = z.enum(['required', 'warn', 'disabled']);
export const hdrMergeDeghostingSchema = z.enum(['off', 'low', 'medium', 'high']);
export const hdrMergeExposureWeightingModeSchema = z.enum(['balanced', 'protect_highlights', 'lift_shadows']);
export const hdrMergeStrategySchema = z.enum(['scene_linear_radiance', 'exposure_fusion_preview']);
export const hdrMergeQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const hdrToneMappingPresetSchema = z.enum([
  'custom',
  'natural',
  'highlight_detail',
  'interior_lift',
  'fast_preview',
]);

export const hdrMergeUiSettingsSchema = z
  .object({
    alignmentMode: hdrMergeAlignmentModeSchema,
    bracketValidation: hdrMergeBracketValidationSchema,
    deghostConfidenceMapVisible: z.boolean(),
    deghostRegionIntensityPercent: z.number().int().min(0).max(100),
    deghosting: hdrMergeDeghostingSchema,
    exposureWeightingMode: hdrMergeExposureWeightingModeSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    mergeStrategy: hdrMergeStrategySchema,
    qualityPreference: hdrMergeQualityPreferenceSchema,
    selectedSourceIndexes: z.array(z.number().int().nonnegative()).min(2),
    sourceMode: z.literal('exposure_bracket'),
    toneMapPreview: z.boolean(),
    toneMappingPreset: hdrToneMappingPresetSchema,
  })
  .strict();

export const hdrRuntimePlanSchema = z
  .object({
    accepted: z.boolean(),
    acceptedDryRunPlanHash: z.string().trim().min(1),
    acceptedDryRunPlanId: z.string().trim().min(1),
    alignmentArtifact: z
      .object({
        artifactHash: z.string().startsWith('blake3:'),
        handle: z.string().startsWith('native:'),
        height: z.number().int().positive(),
        kind: z.literal('scene_linear_alignment_proxy'),
        width: z.number().int().positive(),
      })
      .strict()
      .optional(),
    blockCodes: z.array(z.string().trim().min(1)),
    bracketCount: z.number().int().nonnegative(),
    commonOverlapFraction: z.number().min(0).max(1).optional(),
    dimensionWarnings: z.array(z.string().trim().min(1)).optional(),
    estimatedMemory: z
      .object({
        mergeBufferMb: z.number().int().nonnegative(),
        previewBufferMb: z.number().int().nonnegative(),
        totalMb: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    exposureSpacing: z
      .object({
        maxStepEv: z.number(),
        minStepEv: z.number(),
        spanEv: z.number(),
        stepCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .optional(),
    metadataWarnings: z.array(z.string().trim().min(1)).optional(),
    previewDimensions: z
      .object({
        height: z.number().int().nonnegative(),
        width: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    readiness: z
      .enum(['static_radiance_preview_ready', 'deghost_required', 'deghost_preview_ready', 'deghost_unresolved'])
      .optional(),
    referenceSourceIndex: z.number().int().nonnegative().optional(),
    schemaVersion: z.literal(2).optional(),
    staticRadiancePreview: z
      .object({
        actionState: z.enum(['static_radiance_preview_ready', 'deghost_required']),
        colorState: z.literal('scene_linear_camera_white_balanced_uncalibrated_display_fallback'),
        effectiveSampleMean: z.number().nonnegative(),
        invalidOrClippedCoverage: z.number().min(0).max(1),
        motionCoverage: z.number().min(0).max(1),
        planHash: z.string().startsWith('blake3:'),
        radianceAlgorithmId: z.literal('static_scene_linear_radiance_v1'),
        radianceHandle: z.string().startsWith('native:hdr/radiance-preview/v1/'),
        radianceHash: z.string().startsWith('blake3:'),
        recoveredHighlightCoverage: z.number().min(0).max(1),
        residualHash: z.string().startsWith('blake3:'),
        supportHash: z.string().startsWith('blake3:'),
        toneMapAlgorithmId: z.literal('global_reinhard_review_v1'),
        toneMapExposure: z.number().positive(),
        toneMappedPreviewDataUrl: z.string().startsWith('data:image/png;base64,'),
        toneMappedPreviewHash: z.string().startsWith('blake3:'),
        varianceHash: z.string().startsWith('blake3:'),
        weightHash: z.string().startsWith('blake3:'),
      })
      .strict()
      .optional(),
    deghostPreview: z
      .object({
        actionState: z.enum(['deghost_preview_ready', 'deghost_unresolved']),
        algorithmId: z.literal('scene_linear_owner_feather_v1'),
        colorState: z.literal('scene_linear_camera_white_balanced_uncalibrated_display_fallback'),
        confidenceMean: z.number().min(0).max(1),
        featherHash: z.string().startsWith('blake3:'),
        motionAlgorithmId: z.literal('noise_normalized_motion_probability_v1'),
        motionCoverage: z.number().min(0).max(1),
        motionProbabilityDataUrl: z.string().startsWith('data:image/png;base64,'),
        motionProbabilityHash: z.string().startsWith('blake3:'),
        ownershipAlgorithmId: z.literal('deterministic_source_ownership_v1'),
        ownershipDataUrl: z.string().startsWith('data:image/png;base64,'),
        ownershipHash: z.string().startsWith('blake3:'),
        planHash: z.string().startsWith('blake3:'),
        radianceHash: z.string().startsWith('blake3:'),
        radianceHandle: z.string().startsWith('native:hdr/deghost-preview/v1/'),
        staticRadianceHash: z.string().startsWith('blake3:'),
        toneMapAlgorithmId: z.literal('global_reinhard_review_v1'),
        toneMappedPreviewDataUrl: z.string().startsWith('data:image/png;base64,'),
        toneMappedPreviewHash: z.string().startsWith('blake3:'),
        unresolvedFraction: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    sourcePaths: z.array(z.string().trim().min(1)).optional(),
    sources: z.array(
      z.union([
        z
          .object({
            contentHash: z.string().trim().min(1),
            dimensions: z
              .object({
                height: z.number().int().nonnegative(),
                width: z.number().int().nonnegative(),
              })
              .strict(),
            exposure: z
              .object({
                exposureEv: z.number(),
                exposureTimeSeconds: z.number().positive(),
                iso: z.number().positive(),
              })
              .strict(),
            path: z.string().trim().min(1),
            sourceIndex: z.number().int().nonnegative(),
          })
          .strict(),
        z
          .object({
            activeArea: z
              .object({
                height: z.number().int().positive(),
                width: z.number().int().positive(),
                x: z.number().int().nonnegative(),
                y: z.number().int().nonnegative(),
              })
              .strict(),
            alignment: z
              .object({
                confidence: z.number().min(0).max(1),
                converged: z.boolean(),
                iterations: z.number().int().nonnegative(),
                matrix: z.array(z.number()).length(9),
                model: z.enum(['identity', 'translation']),
                overlapFraction: z.number().min(0).max(1),
                policyId: z.literal('bounded_ncc_translation_v1'),
                residualP95: z.number().nonnegative(),
                residualRms: z.number().nonnegative(),
              })
              .strict(),
            calibration: z
              .object({
                algorithmId: z.literal('cfa_black_white_wb_linear_v1'),
                blackLevels: z.array(z.number()).min(1),
                linearizationId: z.string().min(1),
                whiteBalance: z.array(z.number()).min(3),
                whiteLevels: z.array(z.number()).min(1),
              })
              .strict(),
            cameraMake: z.string().min(1),
            cameraModel: z.string().min(1),
            cfaPattern: z.string().min(1),
            contentHash: z.string().startsWith('blake3:'),
            decoderId: z.literal('rawler_sensor_decode_v1'),
            exposure: z
              .object({
                aperture: z.number().positive(),
                exposureScale: z.number().positive(),
                exposureTimeSeconds: z.number().positive(),
                iso: z.number().positive(),
              })
              .strict(),
            focalLengthMm: z.number().positive(),
            graphRevision: z.string().min(1),
            height: z.number().int().positive(),
            isReference: z.boolean(),
            lensModel: z.string().min(1),
            orientation: z.string().min(1),
            path: z.string().min(1),
            proxyHash: z.string().startsWith('blake3:'),
            proxyId: z.literal('cfa_scene_linear_luma_box_v1'),
            sourceIndex: z.number().int().nonnegative(),
            width: z.number().int().positive(),
          })
          .strict(),
      ]),
    ),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const hdrEditableSourceRefSchema = z
  .object({
    contentHash: z.string().min(1),
    contentState: z.string().min(1),
    displayName: z.string().min(1),
    graphRevision: z.string().min(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const hdrBracketCompareSourceSchema = z
  .object({
    contentHash: z.string().min(1),
    displayName: z.string().min(1),
    exposureEv: z.number(),
    exposureWeightMultiplier: z.number().positive(),
    graphRevision: z.string().min(1),
    selected: z.boolean(),
    sourceIndex: z.number().int().nonnegative(),
    sourceRole: z.enum(['over_exposed', 'reference', 'under_exposed', 'unknown']),
  })
  .strict();

export const hdrBracketCompareReviewSummarySchema = z
  .object({
    accepted: z.boolean().nullable(),
    detectionConfidence: z.number().min(0).max(1).nullable(),
    evidenceSource: z.enum(['runtime_sidecar', 'ui_bracket_preflight', 'source_refs_only']),
    exposureSpreadEv: z.number().nonnegative().nullable(),
    referenceSourceIndex: z.number().int().nonnegative().nullable(),
    reviewStatus: z.enum(['ready', 'limited']),
    selectedSourceCount: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    sources: z.array(hdrBracketCompareSourceSchema),
  })
  .strict();

const hdrParityHashSchema = z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u);

export const hdrPreviewExportParitySummarySchema = z
  .object({
    comparedFields: z.array(
      z.enum([
        'deghosting',
        'displayPreviewColorState',
        'exportColorState',
        'mergeStrategy',
        'outputPath',
        'sourceRefs',
        'toneMapPreview',
      ]),
    ),
    exportReceiptHash: hdrParityHashSchema,
    meanAbsDelta: z.literal(0),
    parityProofHash: hdrParityHashSchema,
    previewStateHash: hdrParityHashSchema,
    status: z.literal('matched_editor_display_path'),
  })
  .strict();

export const hdrEditableHandoffSummarySchema = z
  .object({
    capabilityLevel: z.literal('runtime_apply_capable'),
    deghosting: hdrMergeDeghostingSchema,
    deghostReviewAccepted: z.boolean(),
    deghostReviewRequired: z.boolean(),
    displayPreviewColorState: z.literal('tone_mapped_srgb_preview'),
    editableDerivedAssetId: z.string().min(1),
    exportColorState: z.literal('saved_display_referred_srgb_output'),
    mergeStrategy: hdrMergeStrategySchema,
    outputColorSpace: z.literal('srgb_display_referred_v1'),
    outputEncoding: z.literal('display_referred_preview'),
    outputPath: z.string().min(1),
    previewExportParity: hdrPreviewExportParitySummarySchema,
    previewExportMeanAbsDelta: z.literal(0),
    previewExportParityStatus: z.literal('matched_editor_display_path'),
    previewToneMapped: z.boolean(),
    bracketCompareReview: hdrBracketCompareReviewSummarySchema,
    runtimeSidecarReceipt: hdrRuntimeSidecarReceiptV1Schema.optional(),
    sceneMergeColorState: z.literal('legacy_display_referred_merge_after_linear_to_srgb'),
    sourceCount: z.number().int().nonnegative(),
    sourceRefs: z.array(hdrEditableSourceRefSchema),
    warningCodes: z.array(hdrMergeWarningCodeV1Schema),
    workingColorSpace: z.literal('srgb_display_referred_v1'),
  })
  .strict();

export type HdrMergeUiSettings = z.infer<typeof hdrMergeUiSettingsSchema>;
export type HdrRuntimePlan = z.infer<typeof hdrRuntimePlanSchema>;
export type HdrMergeAlignmentMode = z.infer<typeof hdrMergeAlignmentModeSchema>;
export type HdrMergeBracketValidation = z.infer<typeof hdrMergeBracketValidationSchema>;
export type HdrMergeDeghosting = z.infer<typeof hdrMergeDeghostingSchema>;
export type HdrMergeExposureWeightingMode = z.infer<typeof hdrMergeExposureWeightingModeSchema>;
export type HdrMergeStrategy = z.infer<typeof hdrMergeStrategySchema>;
export type HdrMergeQualityPreference = z.infer<typeof hdrMergeQualityPreferenceSchema>;
export type HdrToneMappingPreset = z.infer<typeof hdrToneMappingPresetSchema>;
export type HdrEditableHandoffSummary = z.infer<typeof hdrEditableHandoffSummarySchema>;
export type HdrBracketCompareReviewSummary = z.infer<typeof hdrBracketCompareReviewSummarySchema>;

type HdrToneMappingPresetPatch = Pick<
  HdrMergeUiSettings,
  | 'deghosting'
  | 'deghostConfidenceMapVisible'
  | 'deghostRegionIntensityPercent'
  | 'exposureWeightingMode'
  | 'maxPreviewDimensionPx'
  | 'mergeStrategy'
  | 'qualityPreference'
  | 'toneMapPreview'
  | 'toneMappingPreset'
>;

export const HDR_TONE_MAPPING_PRESETS: Array<{
  id: Exclude<HdrToneMappingPreset, 'custom'>;
  labelKey: string;
  patch: HdrToneMappingPresetPatch;
}> = [
  {
    id: 'natural',
    labelKey: 'modals.hdr.toneMappingPreset.natural',
    patch: {
      deghosting: 'medium',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 65,
      exposureWeightingMode: 'balanced',
      maxPreviewDimensionPx: 2400,
      mergeStrategy: 'scene_linear_radiance',
      qualityPreference: 'balanced',
      toneMapPreview: true,
      toneMappingPreset: 'natural',
    },
  },
  {
    id: 'highlight_detail',
    labelKey: 'modals.hdr.toneMappingPreset.highlightDetail',
    patch: {
      deghosting: 'high',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 85,
      exposureWeightingMode: 'protect_highlights',
      maxPreviewDimensionPx: 4096,
      mergeStrategy: 'scene_linear_radiance',
      qualityPreference: 'best',
      toneMapPreview: true,
      toneMappingPreset: 'highlight_detail',
    },
  },
  {
    id: 'interior_lift',
    labelKey: 'modals.hdr.toneMappingPreset.interiorLift',
    patch: {
      deghosting: 'medium',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 70,
      exposureWeightingMode: 'lift_shadows',
      maxPreviewDimensionPx: 4096,
      mergeStrategy: 'exposure_fusion_preview',
      qualityPreference: 'balanced',
      toneMapPreview: true,
      toneMappingPreset: 'interior_lift',
    },
  },
  {
    id: 'fast_preview',
    labelKey: 'modals.hdr.toneMappingPreset.fastPreview',
    patch: {
      deghosting: 'low',
      deghostConfidenceMapVisible: false,
      deghostRegionIntensityPercent: 45,
      exposureWeightingMode: 'balanced',
      maxPreviewDimensionPx: 2400,
      mergeStrategy: 'exposure_fusion_preview',
      qualityPreference: 'preview',
      toneMapPreview: true,
      toneMappingPreset: 'fast_preview',
    },
  },
];

export const DEFAULT_HDR_MERGE_UI_SETTINGS = hdrMergeUiSettingsSchema.parse({
  alignmentMode: 'auto',
  bracketValidation: 'required',
  deghostConfidenceMapVisible: false,
  deghostRegionIntensityPercent: 65,
  deghosting: 'medium',
  exposureWeightingMode: 'balanced',
  maxPreviewDimensionPx: 2400,
  mergeStrategy: 'scene_linear_radiance',
  qualityPreference: 'balanced',
  selectedSourceIndexes: [0, 1, 2],
  sourceMode: 'exposure_bracket',
  toneMapPreview: true,
  toneMappingPreset: 'natural',
});

export const normalizeHdrMergeUiSettings = (value: unknown): HdrMergeUiSettings => {
  const parsed = hdrMergeUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_HDR_MERGE_UI_SETTINGS;
};

export const applyHdrToneMappingPreset = (
  settings: HdrMergeUiSettings,
  preset: Exclude<HdrToneMappingPreset, 'custom'>,
): HdrMergeUiSettings => {
  const selectedPreset = HDR_TONE_MAPPING_PRESETS.find((candidate) => candidate.id === preset);
  if (!selectedPreset) return settings;
  return hdrMergeUiSettingsSchema.parse({ ...settings, ...selectedPreset.patch });
};
