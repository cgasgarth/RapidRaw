import { z } from 'zod';

import { getComputationalMergeAppServerRoutePairSummary } from '../../src/utils/computationalMergeAppServerRoutePairs.ts';
import { NegativeLabOutputFormatId } from '../../src/utils/negativeLabOutputFormatIds.ts';

const superResolutionRoutePair = getComputationalMergeAppServerRoutePairSummary('super_resolution');

const filmLookPresetBaseSchema = z
  .object({
    includeCropTransform: z.literal(false),
    includeMasks: z.literal(false),
    presetType: z.literal('style'),
  })
  .passthrough();
const warmPrintPresetSchema = filmLookPresetBaseSchema.extend({
  adjustments: z.object({
    contrast: z.literal(8),
    highlights: z.literal(-10),
    temperature: z.literal(8),
  }),
  name: z.literal('Warm Print 100%'),
});
const monoSilverPresetSchema = filmLookPresetBaseSchema.extend({
  adjustments: z.object({
    contrast: z.literal(12),
    grainAmount: z.literal(22),
    grainSize: z.literal(42),
    saturation: z.literal(-100),
  }),
  name: z.literal('Mono Silver 100%'),
});
const exportedFilmLookPresetSchema = z.union([
  warmPrintPresetSchema.extend({ id: z.string().uuid() }),
  monoSilverPresetSchema.extend({ id: z.string().uuid() }),
]);
const filmLookExportArgsSchema = z.object({
  filePath: z.literal('/tmp/rawengine-film-look-smoke.rrpreset'),
  presetsToExport: z
    .array(
      z.object({
        preset: exportedFilmLookPresetSchema,
      }),
    )
    .length(1),
});
const filmLookSaveCommandSchema = z.union([
  z.object({
    args: warmPrintPresetSchema,
    command: z.literal('save_community_preset'),
    options: z.unknown().optional(),
  }),
  z.object({
    args: monoSilverPresetSchema,
    command: z.literal('save_community_preset'),
    options: z.unknown().optional(),
  }),
]);
const filmLookExportCommandSchema = z.object({
  args: filmLookExportArgsSchema,
  command: z.literal('handle_export_presets_to_file'),
  options: z.unknown().optional(),
});
const filmLookInvokeLogSchema = z.array(z.union([filmLookSaveCommandSchema, filmLookExportCommandSchema]));
const filmLookExportProofSchema = z.object({
  exportedNames: z.array(z.string()).superRefine((names, context) => {
    for (const expectedName of ['Warm Print 100%', 'Mono Silver 100%']) {
      if (!names.includes(expectedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing exported film look preset ${expectedName}.`,
        });
      }
    }
  }),
  savedNames: z.array(z.string()).superRefine((names, context) => {
    for (const expectedName of ['Warm Print 100%', 'Mono Silver 100%']) {
      if (!names.includes(expectedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing saved film look preset ${expectedName}.`,
        });
      }
    }
  }),
});
const visualSmokeInvokeLogSchema = z.array(
  z.object({
    args: z.unknown().optional(),
    command: z.string(),
    options: z.unknown().optional(),
  }),
);
const negativeLabLeftEdgeSampleSchema = z.object({
  height: z.literal(0.6),
  width: z.literal(0.12),
  x: z.literal(0.02),
  y: z.literal(0.2),
});
const negativeLabCustomBaseSampleSchema = z.object({
  height: z.literal(0.18),
  width: z.literal(0.18),
  x: z.literal(0.25),
  y: z.literal(0.25),
});
const negativeLabShadowPatchSampleSchema = z.object({
  height: z.literal(0.18),
  width: z.literal(0.18),
  x: z.literal(0.18),
  y: z.literal(0.62),
});
const negativeLabHighlightPatchSampleSchema = z.object({
  height: z.literal(0.16),
  width: z.literal(0.16),
  x: z.literal(0.66),
  y: z.literal(0.18),
});
const negativeLabPickedNeutralPatchSampleSchema = z.object({
  height: z.number().min(0.24).max(0.26),
  width: z.number().min(0.29).max(0.31),
  x: z.number().min(0.19).max(0.21),
  y: z.number().min(0.19).max(0.21),
});
const negativeLabOrthoPresetParamsSchema = z
  .object({
    base_fog_sample: z.union([negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    black_point: z.literal(0.16),
    blue_weight: z.literal(1.18),
    contrast: z.literal(1.2),
    exposure: z.literal(-0.05),
    green_weight: z.literal(0.96),
    red_weight: z.literal(1.07),
    white_point: z.literal(0.86),
  })
  .passthrough();
const negativeLabPreviewParamsSchema = z
  .object({
    base_fog_sample: z.union([z.null(), negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    black_point: z.number(),
    blue_weight: z.number(),
    contrast: z.number(),
    exposure: z.number(),
    green_weight: z.number(),
    red_weight: z.number(),
    white_point: z.number(),
  })
  .passthrough();
const negativeLabFixturePathSchema = z.union([
  z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
  z.literal('/fixtures/negative-lab/lab-processed-proof-negative-002.jpg'),
  z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.jpg'),
]);
const negativeLabPreviewInvokeSchema = z.object({
  args: z.object({
    params: negativeLabPreviewParamsSchema,
    path: negativeLabFixturePathSchema,
  }),
  command: z.literal('preview_negative_conversion'),
  options: z.unknown().optional(),
});
const negativeLabBaseFogEstimateInvokeSchema = z.object({
  args: z.object({
    path: z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
    sampleRect: z.union([
      z.null(),
      negativeLabLeftEdgeSampleSchema,
      negativeLabCustomBaseSampleSchema,
      negativeLabShadowPatchSampleSchema,
      negativeLabHighlightPatchSampleSchema,
      negativeLabPickedNeutralPatchSampleSchema,
    ]),
  }),
  command: z.literal('estimate_negative_base_fog'),
  options: z.unknown().optional(),
});
const negativeLabHighlightPatchExposureInvokeSchema = z.object({
  args: z.object({
    currentFrameExposureOffset: z.literal(0.5),
    params: negativeLabPreviewParamsSchema,
    path: z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
    sampleRect: negativeLabHighlightPatchSampleSchema,
  }),
  command: z.literal('suggest_negative_lab_highlight_patch_exposure'),
  options: z.unknown().optional(),
});
const negativeLabShadowPatchBlackPointInvokeSchema = z.object({
  args: z.object({
    params: negativeLabPreviewParamsSchema,
    path: z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
    sampleRect: negativeLabShadowPatchSampleSchema,
  }),
  command: z.literal('suggest_negative_lab_shadow_patch_black_point'),
  options: z.unknown().optional(),
});
const negativeLabConvertArgsSchema = z.object({
  options: z
    .object({
      outputFormat: z.literal(NegativeLabOutputFormatId.JpegProof),
      profileProvenanceHash: z
        .string()
        .regex(/^fnv1a32:[a-f0-9]{8}$/u)
        .optional(),
      writeConversionBundle: z.literal(true),
      acquisitionSourceFamilies: z.array(z.enum(['jpeg_lossy', 'raw_like', 'tiff_scan', 'unknown'])).min(1),
      acquisitionWarningCodes: z.array(
        z.enum([
          'lab_processed_input_for_negative_lab',
          'lossy_source_for_negative_lab',
          'mixed_source_families',
          'unknown_acquisition_state',
        ]),
      ),
      batchScope: z.literal('ready'),
      frameExposureOverrides: z.object({
        overrides: z
          .array(
            z.object({
              effectiveExposure: z.literal(0.1),
              exposureOffset: z.literal(0.15),
              frameId: z.literal('negative-lab-frame-1'),
            }),
          )
          .length(1),
        schemaVersion: z.literal(1),
      }),
      frameRgbBalanceOverrides: z.object({
        overrides: z
          .array(
            z.object({
              frameId: z.literal('negative-lab-frame-1'),
              rgbBalanceOffset: z.object({
                blueWeight: z.literal(-0.02),
                greenWeight: z.literal(-0.03),
                redWeight: z.literal(0.07),
              }),
            }),
          )
          .length(1),
        schemaVersion: z.literal(1),
      }),
      omittedDispositionFrameIds: z.array(z.literal('negative-lab-frame-2')).length(1),
      qcApprovedFrameIds: z.array(z.string()).length(0),
      qcRejectedFrameIds: z.array(z.literal('negative-lab-frame-2')).length(1),
      selectedProfile: z
        .object({
          claimLevel: z.literal('generic_starting_point_only'),
          claimPolicy: z.literal('generic_starting_point_no_stock_claim'),
          presetId: z.literal('negative_lab.generic.bw.ortho.v1'),
          profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
          runtimeStatus: z.literal('runtime_parameter_applied'),
        })
        .optional(),
      suffix: z.literal('Positive'),
    })
    .refine(
      (options) =>
        options.profileProvenanceHash === undefined ||
        options.selectedProfile === undefined ||
        options.profileProvenanceHash === options.selectedProfile.profileProvenanceHash,
    ),
  params: negativeLabOrthoPresetParamsSchema,
  paths: z.array(z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif')).length(1),
});
const negativeLabBatchColorParamsSchema = z
  .object({
    base_fog_sample: z.null(),
    base_fog_strength: z.literal(1),
    black_point: z.literal(0),
    blue_weight: z.literal(1.14),
    contrast: z.literal(1),
    exposure: z.literal(0),
    green_weight: z.literal(0.91),
    red_weight: z.literal(1.23),
    white_point: z.literal(1),
  })
  .passthrough();
const negativeLabBatchConvertArgsSchema = z.object({
  options: z
    .object({
      acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
      outputFormat: z.literal(NegativeLabOutputFormatId.JpegProof),
      writeConversionBundle: z.literal(true),
      suffix: z.literal('Positive'),
    })
    .refine(
      (options) =>
        options.acceptedDryRunPlanId ===
        `negative_lab_batch_plan_${options.acceptedDryRunPlanHash.replace('fnv1a32:', '')}`,
      'accepted batch plan id must match hash',
    ),
  params: negativeLabBatchColorParamsSchema,
  paths: z
    .array(
      z.union([
        z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
        z.literal('/fixtures/negative-lab/lab-processed-proof-negative-002.jpg'),
        z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.jpg'),
      ]),
    )
    .length(2),
});
const negativeLabPreviewReturnProofSchema = z.array(z.string().startsWith('data:image/svg+xml,')).min(3);
const negativeLabBasePreviewProofDatasetSchema = z
  .object({
    afterPreviewHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    beforePreviewHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    commandType: z.literal('negativeLab.updateBaseSamples'),
    confidence: z.enum(['high', 'medium', 'low', 'blocked']),
    previewChanged: z.literal('true'),
    previewRevision: z.string().regex(/^[1-9][0-9]*$/u),
    sampleEditMode: z.literal('replace'),
    sampleId: z.string().regex(/^base_sample_[a-f0-9]{8}$/u),
    sampleSource: z.enum(['auto_full_frame', 'custom_rect', 'preset_rect']),
    warningCodes: z.string(),
  })
  .passthrough();
const hdrRoutePair = getComputationalMergeAppServerRoutePairSummary('hdr');
const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const focusStackRoutePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');

export const hdrUiSettingsProofSchema = z.object({
  deghostConfidenceMapVisible: z.literal('true'),
  deghostRegionIntensityPercent: z.literal('85'),
  deghosting: z.literal('high'),
  exposureWeightingMode: z.literal('protect_highlights'),
  maxPreviewDimensionPx: z.literal('4096'),
  mergeStrategy: z.literal('scene_linear_radiance'),
  qualityPreference: z.literal('best'),
  toneMapPreview: z.literal('true'),
  toneMappingPreset: z.literal('custom'),
});
export const hdrReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(hdrRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-hdr-smoke.tif'),
  bracketAccepted: z.literal('true'),
  bracketConfidence: z.string().regex(/^(?:0\.\d+|1)$/u),
  bracketMethod: z.literal('metadata_exposure_time_iso_aperture'),
  bracketSpanEv: z.string().regex(/^4(?:\.\d+)?$/u),
  bracketValidation: z.literal('required'),
  command: z.literal(hdrRoutePair.dryRunToolName),
  deghostConfidenceMapVisible: z.literal('true'),
  deghostRegionIntensityPercent: z.literal('85'),
  deghosting: z.literal('high'),
  estimatedPreviewMegapixels: z.literal('34'),
  exposureWeightingMode: z.literal('protect_highlights'),
  mergeStrategy: z.literal('scene_linear_radiance'),
  qualityPreference: z.literal('best'),
  runtimeStatus: z.literal('dry_run_preview'),
  sourceCount: z.literal('2'),
  toneMappingPreset: z.literal('custom'),
});
const finiteDatasetNumberSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => Number(value))
  .pipe(z.number().finite());
export const hdrBracketSourceRolesProofSchema = z.tuple([
  z.object({
    bracketRole: z.literal('under_exposed'),
    bracketSelected: z.literal('true'),
    exposureEv: finiteDatasetNumberSchema.refine((value) => value < -0.25),
    exposureWeightMultiplier: finiteDatasetNumberSchema.refine((value) => value > 1),
    sourceIndex: z.literal('0'),
  }),
  z.object({
    bracketRole: z.literal('reference'),
    bracketSelected: z.literal('false'),
    exposureEv: finiteDatasetNumberSchema.refine((value) => value >= -0.25 && value <= 0.25),
    exposureWeightMultiplier: finiteDatasetNumberSchema.refine((value) => value === 1),
    sourceIndex: z.literal('1'),
  }),
  z.object({
    bracketRole: z.literal('over_exposed'),
    bracketSelected: z.literal('true'),
    exposureEv: finiteDatasetNumberSchema.refine((value) => value > 0.25),
    exposureWeightMultiplier: finiteDatasetNumberSchema.refine((value) => value === 1),
    sourceIndex: z.literal('2'),
  }),
]);
export const hdrDeghostReviewGateProofSchema = z.object({
  deghostLevel: z.literal('high'),
  motionRisk: z.literal('high'),
  reviewApproved: z.literal('true'),
  reviewRequired: z.literal('true'),
});
export const panoramaUiSettingsProofSchema = z.object({
  blendMode: z.literal('feather'),
  boundaryMode: z.literal('auto_crop'),
  exposureMode: z.literal('none'),
  maxPreviewDimensionPx: z.literal('8192'),
  projection: z.literal('cylindrical'),
  qualityPreference: z.literal('preview'),
  seamExposureCompensationPercent: z.literal('60'),
});
export const panoramaReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(panoramaRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/panorama.tif'),
  command: z.literal(panoramaRoutePair.dryRunToolName),
  estimatedPreviewMegapixels: z.literal('336'),
  planMemoryMb: z.literal('952'),
  planScope: z.literal('geometry_memory_only'),
  planStatus: z.literal('accepted'),
  planWidth: z.literal('9024'),
  projection: z.literal('cylindrical'),
  runtimeStatus: z.literal('dry_run_preview'),
  seamExposureCompensationPercent: z.literal('60'),
  seamCount: z.literal('4'),
  sourceContributionCount: z.literal('5'),
  sourceCount: z.literal('5'),
  sourceOrder: z.literal('left,center,right,detail,sky'),
});
export const panoramaQualityDiagnosticsProofSchema = z.object({
  cropCoveragePercent: z.literal('92'),
  excludedSourceCount: z.literal('0'),
  inlierEdgeCount: z.literal('4'),
  lowConfidenceSeamCount: z.literal('0'),
  seamCount: z.literal('4'),
  seamMaxP95ErrorPx: z.literal('3.1'),
  seamReviewStatus: z.literal('requires_review'),
  stitchedSourceCount: z.literal('5'),
  warningCodes: z.literal('geometry_estimate_low_confidence,legacy_full_frame_render'),
});
export const panoramaSavedReviewProofSchema = z.object({
  boundaryMode: z.literal('auto_crop'),
  capabilityLevel: z.literal('runtime_apply_capable'),
  cropRectangle: z.literal('100,80,9024,3200'),
  outputDimensions: z.literal('9024 x 3200'),
  outputPath: z.literal('/tmp/panorama.tif'),
  projection: z.literal('cylindrical'),
  seamCount: z.literal('4'),
  seamMaxP95ErrorPx: z.literal('3.1'),
  seamReviewStatus: z.literal('requires_review'),
  sourceContributionRegions: z.literal('5'),
  sourceExcludedCount: z.literal('0'),
  sourceCount: z.literal('5'),
  warningCodes: z.literal('geometry_estimate_low_confidence,legacy_full_frame_render'),
});
export const panoramaPrivateRawReviewProofSchema = z.object({
  applyCommand: z.literal(panoramaRoutePair.applyToolName),
  artifactPath: z.string().endsWith('/panorama-overlap-merge.tiff'),
  command: z.literal(panoramaRoutePair.dryRunToolName),
  exportReviewArtifact: z.string().endsWith('/panorama-overlap-export-review.png'),
  fixtureId: z.literal('validation.computational-merge.panorama-overlap.v1'),
  previewArtifact: z.string().endsWith('/panorama-overlap-preview.png'),
  resultReviewArtifact: z.string().endsWith('/panorama-overlap-result-review.png'),
  runtimeStatus: z.literal('private_raw_app_server_apply'),
  sourceCount: z.literal('3'),
});
export const focusUiSettingsProofSchema = z.object({
  alignmentMode: z.literal('homography'),
  blendMethod: z.literal('depth_map'),
  haloSuppressionStrengthPercent: z.literal('80'),
  maxPreviewDimensionPx: z.literal('8192'),
  qualityPreference: z.literal('preview'),
  reviewOverlayMode: z.literal('halo_risk'),
  reviewOverlayOpacityPercent: z.literal('100'),
  retouchLayerPolicy: z.literal('none'),
});
export const focusReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(focusStackRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-focus-stack-smoke.tif'),
  command: z.literal(focusStackRoutePair.dryRunToolName),
  decision: z.literal('preview_only'),
  depthMode: z.literal('depth_map'),
  estimatedPreviewMegapixels: z.literal('403'),
  haloRiskCellRatio: z.literal('0.07'),
  haloPolicy: z.literal('flattened_preview'),
  haloSuppressionStrengthPercent: z.literal('80'),
  lowConfidenceCellRatio: z.literal('0.08'),
  proofLevel: z.literal('synthetic_runtime'),
  reviewOverlayMode: z.literal('halo_risk'),
  reviewOverlayOpacityPercent: z.literal('100'),
  sourceDetailCount: z.literal('6'),
  runtimeStatus: z.literal('dry_run_preview'),
  sharpnessCoverageRatio: z.literal('1'),
  sourceContributionSummary: z.literal('S1 17% / S2 17% / S3 17% / S4 17% / S5 17% / S6 17%'),
  sourceCount: z.literal('6'),
  sourceCoverageDetails: z.literal('6'),
  warningCodes: z.literal('human_review_required,synthetic_runtime_only,transition_halo_risk,depth_map_preview_only'),
});
export const focusPrivateRawReviewProofSchema = z.object({
  applyCommand: z.literal(focusStackRoutePair.applyToolName),
  artifactPath: z.string().endsWith('/focus-plane-merge.tiff'),
  command: z.literal(focusStackRoutePair.dryRunToolName),
  exportReviewArtifact: z.string().endsWith('/focus-plane-export-review.png'),
  fixtureId: z.literal('validation.computational-merge.focus-plane-transition.v1'),
  previewArtifact: z.string().endsWith('/focus-plane-preview.png'),
  resultReviewArtifact: z.string().endsWith('/focus-plane-result-review.png'),
  runtimeStatus: z.literal('private_raw_app_server_apply'),
  sourceCount: z.literal('3'),
});
export const hdrPrivateRawReviewProofSchema = z.object({
  afterArtifact: z.string().endsWith('/hdr-bracket-modal-after.png'),
  beforeArtifact: z.string().endsWith('/hdr-bracket-modal-before.png'),
  exportArtifact: z.string().endsWith('/hdr-bracket-export.tiff'),
  fixtureId: z.literal('validation.computational-merge.hdr-bracket-alignment.v1'),
  mergeArtifact: z.string().endsWith('/hdr-bracket-merge.tiff'),
  previewArtifact: z.string().endsWith('/hdr-bracket-preview.png'),
  runtimeStatus: z.literal('private_raw_app_server_apply'),
  sourceCount: z.literal('3'),
});
export const superResolutionUiSettingsProofSchema = z.object({
  alignmentMode: z.literal('optical_flow'),
  detailPolicy: z.literal('aggressive_preview_only'),
  maxPreviewDimensionPx: z.literal('8192'),
  outputScale: z.literal('4'),
  qualityPreference: z.literal('preview'),
  reconstructionMode: z.literal('optical_flow'),
});
export const superResolutionReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(superResolutionRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-super-resolution-smoke.tif'),
  command: z.literal(superResolutionRoutePair.dryRunToolName),
  decision: z.literal('preview_only'),
  detailPolicy: z.literal('aggressive_preview_only'),
  detailGainRatio: z.literal('1.21'),
  estimatedPreviewMegapixels: z.literal('336'),
  mode: z.literal('aggressive'),
  modePolicyVersion: z.literal('1'),
  outputScale: z.literal('4'),
  proofLevel: z.literal('synthetic_runtime'),
  reconstructionMode: z.literal('optical_flow'),
  reviewPacketPath: z.literal('docs/validation/sr-synthetic-output-artifact-proof-2026-06-20.json'),
  runtimeStatus: z.literal('dry_run_preview'),
  reviewCropCount: z.literal('4'),
  sourcePreflightEffectiveScale: z.literal('2'),
  sourcePreflightStatus: z.literal('ready'),
  sourceCount: z.literal('5'),
  warningCodes: z.literal('human_review_required,synthetic_runtime_only,texture_risk,aggressive_preview_only'),
});
export const superResolutionPrivateRawReviewProofSchema = z.object({
  applyCommand: z.literal(superResolutionRoutePair.applyToolName),
  artifactPath: z.string().endsWith('/sr-subpixel-reconstruction.tiff'),
  command: z.literal(superResolutionRoutePair.dryRunToolName),
  exportReviewArtifact: z.string().endsWith('/sr-subpixel-export-review.png'),
  fixtureId: z.literal('validation.computational-merge.super-resolution-subpixel.v1'),
  previewArtifact: z.string().endsWith('/sr-subpixel-preview.png'),
  resultReviewArtifact: z.string().endsWith('/sr-subpixel-result-review.png'),
  runtimeStatus: z.literal('private_raw_app_server_apply'),
  sourceCount: z.literal('4'),
});
export const layerStackWorkflowProofSchema = z.object({
  activeLayer: z.literal('Proof polish'),
  blendMode: z.literal('overlay'),
  collapsedGroupCount: z.literal('0'),
  groupedLayerCount: z.literal('2'),
  groupingState: z.literal('active'),
  layerCount: z.literal('5'),
  mask: z.literal('Brush'),
  opacity: z.literal('64'),
  visibleCount: z.literal('4'),
});
export const layerStackExportParityProofSchema = z.object({
  exportParity: z.literal('ready'),
});
export const layerMaskPrivateRawReviewProofSchema = z.object({
  brushCommandType: z.literal('layerMask.createBrushMask').optional(),
  exportArtifact: z.string().endsWith('/alaska-layer-mask-v1-refined-export.tiff'),
  fixtureId: z.literal('validation.layer-mask-real-raw.alaska-local-adjustment.v1'),
  metricCount: z.literal('5'),
  refineCommandType: z.literal('layerMask.refineMask').optional(),
  refinedPreviewArtifact: z.string().endsWith('/alaska-layer-mask-v1-refined-preview.png'),
  runtimeStatus: z.literal('private_raw_tauri_runtime_proof'),
  unmaskedPreviewArtifact: z.string().endsWith('/alaska-layer-mask-v1-unmasked-preview.png'),
  unrefinedPreviewArtifact: z.string().endsWith('/alaska-layer-mask-v1-unrefined-preview.png'),
});
export const maskOverlayRawProofSchema = z.object({
  edgeThreshold: z.literal('0.64'),
  hiddenToggled: z.literal('true'),
  mode: z.literal('edges'),
  opacity: z.literal('0.70'),
  overlaySource: z.literal('live_mask_overlay_generator'),
  sourceKind: z.literal('source_raw_private'),
  sourcePath: z.literal('private-fixtures/detail/high-iso-skin-shadow-v1.arw'),
  validationMode: z.literal('visual_smoke_raw_overlay_control_proof'),
});
export const libraryWorkflowProofSchema = z.object({
  activeAsset: z.literal('DSC_0002.NEF'),
  colorLabel: z.literal('green'),
  filterMode: z.literal('keepers'),
  minimumRating: z.literal('4'),
  openedEditorPath: z.literal('/proof-roll/DSC_0002.NEF'),
  queuedExportId: z.literal('export-dsc-0002-current-edit-tiff16'),
  selectedCount: z.literal('2'),
  sidecarSeparation: z.literal('independent'),
  surveyPickExportQueued: z.literal('true'),
  surveyPickOpenedEditor: z.literal('true'),
  viewMode: z.literal('compare'),
  virtualCompareReady: z.literal('true'),
  virtualCopyId: z.literal('vc-dsc-0002-bw-proof'),
  virtualCopySourcePath: z.literal('/proof-roll/DSC_0002.NEF'),
  virtualCopyVariantPath: z.literal('/proof-roll/DSC_0002.NEF?vc=vc-dsc-0002-bw-proof'),
});
export const detailWorkspaceProofSchema = z.object({
  artifactWarning: z.literal('ringing_review'),
  comparisonMode: z.literal('original_current_recipe_export'),
  cropClipped: z.literal('false'),
  cropZoomPercent: z.literal('100'),
  deblurCommand: z.literal('detail.deblur.dry_run_command'),
  deblurEnabled: z.literal('true'),
  deblurStrength: z.literal('70'),
  denoiseLuma: z.literal('58'),
  denoiseStage: z.literal('scene_linear_denoise'),
  exportArtifactPath: z.string().endsWith('/high-iso-skin-shadow-v1-enabled-export.pgm'),
  fixtureId: z.literal('detail.output.high-iso-denoise-detail-100.v1'),
  previewMode: z.literal('split'),
  recipeApplied: z.literal('true'),
  recipeId: z.literal('detail.output.denoise-detail-100.v1'),
  renderFallback: z.literal('false'),
  runtimeStatus: z.literal('synthetic_detail_output_comparison_artifact_rendered'),
  warningCodes: z.literal('halo_risk_review,oversmoothing_review,crop_bounds_ok'),
  waveletMode: z.literal('luma_detail'),
  zoom: z.literal('100'),
});
export const detailDustSpotProofSchema = z.object({
  minRadius: z.literal('6'),
  overlayEnabled: z.literal('true'),
  sensitivity: z.literal('72'),
});
export const commandPaletteWorkflowProofSchema = z.object({
  focusOpen: z.literal('true'),
  hdrOpen: z.literal('true'),
  negativeOpen: z.literal('true'),
  panoramaOpen: z.literal('true'),
  srOpen: z.literal('true'),
});
export const negativeLabPublicExportReviewProofSchema = z.object({
  baseFogSample: z.literal('0,0,0.35,0.35'),
  baseFogStrength: z.literal('1'),
  changedPixelRatio: z.literal('1'),
  densityWeights: z.literal('1.0299999713897705,1,0.9800000190734863'),
  exportPlanId: z.literal('negative_lab_batch_plan_2f4a91bc'),
  fixtureId: z.literal('negative_lab.real.public.cc0_110_ericht_negative_001'),
  outputFormat: z.literal('jpeg_proof'),
  outputPath: z.string().endsWith('/110-format-ericht-negative-cc0-320-Positive.jpg'),
  profileClaimPolicy: z.literal('generic_starting_point_no_stock_claim'),
  profileDisplayName: z.literal('C-41 Portrait'),
  profilePresetId: z.literal('negative_lab.generic.c41.portrait.v1'),
  profileProvenanceHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
  runtimeStatus: z.literal('public_negative_scan_positive_export_rendered'),
  sourcePath: z.literal('fixtures/negative-lab/public/110-format-ericht-negative-cc0-320.jpg'),
});
export const negativeLabRealRawPrivateReviewProofSchema = z.object({
  changedPixelRatio: z.string().regex(/^0\.[0-9]+|1$/u),
  fixtureId: z.literal('validation.negative-lab-real-raw.alaska.v1'),
  inputToOutputMeanAbsDelta: z.string().regex(/^0\.[0-9]+|1$/u),
  outputFormat: z.literal('jpeg_proof'),
  outputPath: z.string().endsWith('/alaska-negative-lab-v1-Positive.jpg'),
  proofBoundary: z.literal('private_raw_negative_lab_runtime_not_final_negative_quality'),
  proofStatus: z.literal('private_raw_negative_lab_positive_export_rendered'),
  sourceIsRaw: z.literal('true'),
  sourcePath: z.literal('private-fixtures/negative-lab/alaska-negative-lab-v1.arw'),
});
export const selectiveColorUiProofDatasetSchema = z.object({
  activeRange: z.literal('oranges'),
  commandType: z.literal('toneColor.adjustHsl'),
});
export const colorBalanceCompareProofDatasetSchema = z
  .object({
    afterRgb: z.string().regex(/^R [0-9]+ \/ G [0-9]+ \/ B [0-9]+$/u),
    beforeRgb: z.string().regex(/^R [0-9]+ \/ G [0-9]+ \/ B [0-9]+$/u),
    clipChannelCount: z.literal('0'),
    commandSummary: z.literal('toneColor.colorBalanceRgb'),
    compareChanged: z.literal('true'),
  })
  .superRefine((proof, context) => {
    if (proof.beforeRgb === proof.afterRgb) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Color balance comparison must change RGB output.' });
    }
  });
export const agentChatProofDatasetSchema = z.object({
  agentRuntimeStatus: z.literal('runtime_apply_demo'),
});
export const agentArtifactReviewProofDatasetSchema = z.object({
  artifactCount: z.literal('3'),
  auditCount: z.literal('3'),
  beforeRevision: z.literal('graph_rev_agent_expert_edit_demo_initial_2844'),
});
export const agentReviewHandoffProofDatasetSchema = z.object({
  afterArtifactId: z.literal('artifact_agent_expert_edit_demo_after_virtual_copy_2844'),
  approvalState: z.literal('approved'),
  beforeArtifactId: z.literal('artifact_agent_expert_edit_demo_before_raw_2844'),
  outputProofStatus: z.literal('runtime_apply_verified'),
  rollbackStatus: z.literal('available'),
});
export const agentSelectedFrameScopeProofDatasetSchema = z.object({
  approvalState: z.literal('required'),
  auditArtifactId: z.literal('audit-record-tool-2'),
  dryRunToolCallId: z.literal('tool-2'),
  excludedAssetCount: z.literal('2'),
  noOverwriteTarget: z.literal('Virtual copy sidecar'),
  policyCheckCount: z.literal('3'),
  proofHref: z.string().endsWith('agent-expert-edit-demo-workflow-2026-06-21.html'),
  selectedAssetCount: z.literal('2'),
});
export const agentAuditTranscriptViewerProofDatasetSchema = z.object({
  applyRecordCount: z.literal('1'),
  artifactLinkCount: z.literal('3'),
  evidenceTier: z.literal('runtime_apply_demo'),
  recordCount: z.literal('4'),
  replayRoot: z.string().endsWith('agent-expert-edit-demo-workflow-2026-06-21.html'),
  schemaVersion: z.literal('1'),
  warningCount: z.literal('2'),
});
export const agentDryRunReviewProofDatasetSchema = z.object({
  actionCount: z.literal('3'),
  affectedTargetCount: z.literal('3'),
  applyAvailability: z.literal('runtime_apply_demo'),
  approvalStates: z.string().superRefine((states, context) => {
    for (const expectedState of ['available']) {
      if (!states.split(',').includes(expectedState)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing dry-run review state ${expectedState}.`,
        });
      }
    }
  }),
  localReviewDecision: z.enum(['approved', 'pending', 'rejected']),
  parameterDiffCount: z.literal('3'),
  policyAvailability: z.literal('reviewable'),
  warningCount: z.literal('2'),
});
export const agentPrivateRawArtifactsProofDatasetSchema = z.object({
  artifactCount: z.literal('5'),
  fixtureId: z.literal('validation.raw-open-edit-export.high-iso-skin-shadow.v1'),
  issue: z.literal('3033'),
  sourceHashUnchanged: z.literal('true'),
  status: z.literal('partial_agent_apply_plus_private_raw_artifacts'),
  validationMode: z.literal('agent_app_server_bridge_plus_private_raw_artifact_proof'),
});
export const negativeLabWorkspaceProofDatasetSchema = z.object({
  activeStage: z.enum(['colorInversion', 'export', 'inspection']),
  exportReady: z.enum(['false', 'true']),
  previewReady: z.literal('true'),
  queuedCount: z.string().regex(/^[1-9][0-9]*$/u),
  reviewCount: z.string().regex(/^[0-9]+$/u),
  retouchCount: z.literal('0'),
  schemaVersion: z.literal('1'),
  targetCount: z.string().regex(/^[1-9][0-9]*$/u),
});
export const negativeLabRollQueueSummaryProofSchema = z.object({
  activeFrameId: z.literal('negative-lab-frame-1'),
  baseScope: z.enum(['frame', 'roll']),
  baseStatus: z.enum(['estimated', 'pending']),
  exportReady: z.enum(['false', 'true']),
  plannedApplyCount: z.literal('2'),
  profileId: z.string().min(1),
  reviewFrameCount: z.string().regex(/^[0-9]+$/u),
  warningCount: z.string().regex(/^[0-9]+$/u),
});

export async function assertFilmLookExportProof(page) {
  const rawInvokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const invokeLog = filmLookInvokeLogSchema.parse(
    rawInvokeLog.filter((call) => ['handle_export_presets_to_file', 'save_community_preset'].includes(call.command)),
  );
  const savedNames = invokeLog.filter((call) => call.command === 'save_community_preset').map((call) => call.args.name);
  const exportedNames = invokeLog
    .filter((call) => call.command === 'handle_export_presets_to_file')
    .map((call) => call.args.presetsToExport[0]?.preset.name ?? '<missing>');

  filmLookExportProofSchema.parse({ exportedNames, savedNames });
}

export async function assertNegativeLabInvokeProof(page) {
  const invokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const convertCall = invokeLog.find((call) => call.command === 'convert_negatives');

  if (convertCall === undefined) {
    throw new Error('Negative Lab convert invoke was not recorded.');
  }

  negativeLabConvertArgsSchema.parse(convertCall.args);
}

export async function assertNegativeLabBaseFogPreviewExportProof(page) {
  const rawInvokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const previewCalls = z
    .array(negativeLabPreviewInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'preview_negative_conversion'));
  const estimateCalls = z
    .array(negativeLabBaseFogEstimateInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'estimate_negative_base_fog'));
  const highlightExposureCalls = z
    .array(negativeLabHighlightPatchExposureInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'suggest_negative_lab_highlight_patch_exposure'));
  const shadowBlackPointCalls = z
    .array(negativeLabShadowPatchBlackPointInvokeSchema)
    .parse(rawInvokeLog.filter((call) => call.command === 'suggest_negative_lab_shadow_patch_black_point'));
  const previewReturns = negativeLabPreviewReturnProofSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_NEGATIVE_LAB_PREVIEW_RETURNS__ ?? []),
  );
  const hasAutoEstimate = estimateCalls.some((call) => call.args.sampleRect === null);
  const hasManualEstimate = estimateCalls.some((call) => call.args.sampleRect !== null);
  const hasCustomBaseEstimate = estimateCalls.some(
    (call) => negativeLabCustomBaseSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasPatchProbeEstimate = estimateCalls.some(
    (call) => negativeLabShadowPatchSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasHighlightPatchEstimate = estimateCalls.some(
    (call) => negativeLabHighlightPatchSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasPickedNeutralPatchEstimate = estimateCalls.some(
    (call) => negativeLabPickedNeutralPatchSampleSchema.safeParse(call.args.sampleRect).success,
  );
  const hasAutoPreview = previewCalls.some((call) => call.args.params.base_fog_sample === null);
  const hasManualPreview = previewCalls.some(
    (call) => call.args.params.base_fog_sample !== null && call.args.params.blue_weight === 1.18,
  );
  const hasCustomBasePreview = previewCalls.some(
    (call) => negativeLabCustomBaseSampleSchema.safeParse(call.args.params.base_fog_sample).success,
  );

  if (
    !hasAutoEstimate ||
    !hasManualEstimate ||
    !hasCustomBaseEstimate ||
    !hasPatchProbeEstimate ||
    !hasHighlightPatchEstimate ||
    !hasPickedNeutralPatchEstimate ||
    highlightExposureCalls.length !== 1 ||
    !hasAutoPreview ||
    !hasManualPreview ||
    !hasCustomBasePreview
  ) {
    throw new Error(
      `Negative Lab base/fog proof did not exercise auto and sampled preview paths: ${JSON.stringify({
        hasAutoEstimate,
        hasAutoPreview,
        hasCustomBaseEstimate,
        hasCustomBasePreview,
        hasHighlightPatchEstimate,
        hasManualEstimate,
        hasManualPreview,
        hasPickedNeutralPatchEstimate,
        hasPatchProbeEstimate,
        highlightExposureCalls: highlightExposureCalls.length,
      })}`,
    );
  }

  if (shadowBlackPointCalls.length !== 1) {
    throw new Error(
      `Negative Lab shadow black-point proof expected one suggestion call, got ${shadowBlackPointCalls.length}.`,
    );
  }

  if (new Set(previewReturns).size < 2) {
    throw new Error('Negative Lab sampled preview proof did not produce distinct preview render payloads.');
  }

  const basePreviewProof = negativeLabBasePreviewProofDatasetSchema.parse(
    await page.getByTestId('negative-lab-base-preview-proof').evaluate((element) => ({ ...element.dataset })),
  );
  if (!['custom_rect', 'preset_rect'].includes(basePreviewProof.sampleSource)) {
    throw new Error(`Negative Lab base preview proof used unexpected source: ${basePreviewProof.sampleSource}`);
  }
}

export async function assertNegativeLabBatchColorInvokeProof(page) {
  const invokeLog = visualSmokeInvokeLogSchema.parse(
    await page.evaluate(() => window.__RAWENGINE_VISUAL_SMOKE_INVOKES__ ?? []),
  );
  const convertCall = invokeLog.find((call) => call.command === 'convert_negatives');

  if (convertCall === undefined) {
    throw new Error('Negative Lab batch convert invoke was not recorded.');
  }

  negativeLabBatchConvertArgsSchema.parse(convertCall.args);
}
