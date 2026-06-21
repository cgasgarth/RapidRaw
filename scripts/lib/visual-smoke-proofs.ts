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
const negativeLabOrthoPresetParamsSchema = z
  .object({
    base_fog_sample: z.union([negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    blue_weight: z.literal(1.18),
    contrast: z.literal(1.2),
    exposure: z.literal(-0.05),
    green_weight: z.literal(0.96),
    red_weight: z.literal(1.07),
  })
  .passthrough();
const negativeLabPreviewParamsSchema = z
  .object({
    base_fog_sample: z.union([z.null(), negativeLabLeftEdgeSampleSchema, negativeLabCustomBaseSampleSchema]),
    base_fog_strength: z.literal(1),
    blue_weight: z.number(),
    contrast: z.number(),
    exposure: z.number(),
    green_weight: z.number(),
    red_weight: z.number(),
  })
  .passthrough();
const negativeLabFixturePathSchema = z.union([
  z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif'),
  z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif'),
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
    ]),
  }),
  command: z.literal('estimate_negative_base_fog'),
  options: z.unknown().optional(),
});
const negativeLabConvertArgsSchema = z.object({
  options: z.object({
    outputFormat: z.literal(NegativeLabOutputFormatId.JpegProof),
    suffix: z.literal('Positive'),
  }),
  params: negativeLabOrthoPresetParamsSchema,
  paths: z.array(z.literal('/fixtures/negative-lab/synthetic-color-negative-001.tif')).length(1),
});
const negativeLabBatchColorParamsSchema = z
  .object({
    base_fog_sample: z.null(),
    base_fog_strength: z.literal(1),
    blue_weight: z.literal(1.14),
    contrast: z.literal(1),
    exposure: z.literal(0),
    green_weight: z.literal(0.91),
    red_weight: z.literal(1.23),
  })
  .passthrough();
const negativeLabBatchConvertArgsSchema = z.object({
  options: z
    .object({
      acceptedDryRunPlanHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
      acceptedDryRunPlanId: z.string().regex(/^negative_lab_batch_plan_[a-f0-9]{8}$/u),
      outputFormat: z.literal(NegativeLabOutputFormatId.JpegProof),
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
        z.literal('/fixtures/negative-lab/synthetic-gray-ramp-negative-002.tif'),
      ]),
    )
    .length(2),
});
const negativeLabPreviewReturnProofSchema = z.array(z.string().startsWith('data:image/svg+xml,')).min(3);
const hdrRoutePair = getComputationalMergeAppServerRoutePairSummary('hdr');
const panoramaRoutePair = getComputationalMergeAppServerRoutePairSummary('panorama');
const focusStackRoutePair = getComputationalMergeAppServerRoutePairSummary('focus_stack');

export const hdrUiSettingsProofSchema = z.object({
  deghosting: z.literal('high'),
  maxPreviewDimensionPx: z.literal('8192'),
  toneMapPreview: z.literal('false'),
});
export const hdrReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(hdrRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-hdr-smoke.tif'),
  bracketValidation: z.literal('required'),
  command: z.literal(hdrRoutePair.dryRunToolName),
  deghosting: z.literal('high'),
  estimatedPreviewMegapixels: z.literal('201'),
  runtimeStatus: z.literal('dry_run_preview'),
  sourceCount: z.literal('3'),
});
export const panoramaUiSettingsProofSchema = z.object({
  blendMode: z.literal('feather'),
  boundaryMode: z.literal('auto_crop'),
  exposureMode: z.literal('none'),
  maxPreviewDimensionPx: z.literal('8192'),
  projection: z.literal('rectilinear'),
  qualityPreference: z.literal('preview'),
});
export const panoramaReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(panoramaRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/panorama.tif'),
  command: z.literal(panoramaRoutePair.dryRunToolName),
  estimatedPreviewMegapixels: z.literal('336'),
  planMemoryMb: z.literal('952'),
  planScope: z.literal('geometry_memory_only'),
  planStatus: z.literal('accepted'),
  planWidth: z.literal('9600'),
  projection: z.literal('rectilinear'),
  runtimeStatus: z.literal('dry_run_preview'),
  sourceCount: z.literal('5'),
  sourceOrder: z.literal('left,center,right,detail,sky'),
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
  maxPreviewDimensionPx: z.literal('8192'),
  qualityPreference: z.literal('preview'),
  retouchLayerPolicy: z.literal('none'),
});
export const focusReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(focusStackRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-focus-stack-smoke.tif'),
  command: z.literal(focusStackRoutePair.dryRunToolName),
  depthMode: z.literal('depth_map'),
  estimatedPreviewMegapixels: z.literal('403'),
  haloPolicy: z.literal('flattened_preview'),
  runtimeStatus: z.literal('dry_run_preview'),
  sourceCount: z.literal('6'),
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
});
export const superResolutionReviewWorkspaceProofSchema = z.object({
  applyCommand: z.literal(superResolutionRoutePair.applyToolName),
  artifactPath: z.literal('/tmp/rawengine-super-resolution-smoke.tif'),
  command: z.literal(superResolutionRoutePair.dryRunToolName),
  detailPolicy: z.literal('aggressive_preview_only'),
  estimatedPreviewMegapixels: z.literal('336'),
  outputScale: z.literal('4'),
  runtimeStatus: z.literal('dry_run_preview'),
  sourceCount: z.literal('5'),
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
  groupingState: z.literal('deferred'),
  layerCount: z.literal('5'),
  mask: z.literal('Brush'),
  opacity: z.literal('64'),
  visibleCount: z.literal('4'),
});
export const layerStackExportParityProofSchema = z.object({
  exportParity: z.literal('ready'),
});
export const layerMaskPrivateRawReviewProofSchema = z.object({
  exportArtifact: z.string().endsWith('/alaska-layer-mask-v1-refined-export.tiff'),
  fixtureId: z.literal('validation.layer-mask-real-raw.alaska-local-adjustment.v1'),
  metricCount: z.literal('5'),
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
  selectedCount: z.literal('2'),
  viewMode: z.literal('survey'),
  virtualCopyId: z.literal('vc-dsc-0002-bw-proof'),
});
export const detailWorkspaceProofSchema = z.object({
  artifactWarning: z.literal('ringing_review'),
  deblurCommand: z.literal('detail.deblur.dry_run_command'),
  denoiseStage: z.literal('scene_linear_denoise'),
  previewMode: z.literal('split'),
  runtimeStatus: z.literal('fixture_runtime_paths'),
  waveletMode: z.literal('luma_detail'),
  zoom: z.literal('200'),
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
export const selectiveColorUiProofDatasetSchema = z.object({
  activeRange: z.literal('oranges'),
  commandType: z.literal('toneColor.adjustHsl'),
});
export const agentChatProofDatasetSchema = z.object({
  agentRuntimeStatus: z.literal('ui_only_demo'),
});
export const agentArtifactReviewProofDatasetSchema = z.object({
  artifactCount: z.literal('3'),
  auditCount: z.literal('3'),
  beforeRevision: z.literal('graph_rev_44'),
});
export const agentAuditTranscriptViewerProofDatasetSchema = z.object({
  applyRecordCount: z.literal('1'),
  artifactLinkCount: z.literal('3'),
  evidenceTier: z.literal('schema_only'),
  recordCount: z.literal('3'),
  replayRoot: z.string().endsWith('agent-replay-proof-gallery-2026-06-16.html'),
  schemaVersion: z.literal('1'),
  warningCount: z.literal('2'),
});
export const agentDryRunReviewProofDatasetSchema = z.object({
  actionCount: z.literal('3'),
  affectedTargetCount: z.literal('3'),
  applyAvailability: z.literal('unavailable'),
  approvalStates: z.string().superRefine((states, context) => {
    for (const expectedState of ['available', 'unavailable']) {
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
        hasManualEstimate,
        hasManualPreview,
        hasPatchProbeEstimate,
      })}`,
    );
  }

  if (new Set(previewReturns).size < 2) {
    throw new Error('Negative Lab sampled preview proof did not produce distinct preview render payloads.');
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
