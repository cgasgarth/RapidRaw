import { z } from 'zod';

export const panoramaUiProjectionSchema = z.enum(['rectilinear', 'cylindrical', 'spherical']);
export const panoramaUiBoundaryModeSchema = z.enum(['auto_crop', 'transparent', 'manual_crop']);
export const panoramaUiBlendModeSchema = z.enum(['feather', 'multi_band']);
export const panoramaUiExposureModeSchema = z.enum(['gain_compensation', 'none']);
export const panoramaUiQualityPreferenceSchema = z.enum(['preview', 'balanced', 'best']);
export const panoramaRuntimePlanStatusSchema = z.enum(['accepted', 'warning', 'blocked_plan_only']);

const panoramaSourceGeometryConnectivitySchema = z
  .object({
    connectedSourceCount: z.number().int().nonnegative(),
    disconnectedSourceCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    isConnected: z.boolean(),
  })
  .strict();

const panoramaRuntimeSourceGeometryConnectivitySchema = z
  .object({
    connected_source_count: z.number().int().nonnegative(),
    disconnected_source_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    is_connected: z.boolean(),
  })
  .strict();

const panoramaSourceGeometryConfidenceSchema = z
  .object({
    columnConfidence: z.number().min(0).max(1),
    overallConfidence: z.number().min(0).max(1),
    rowConfidence: z.number().min(0).max(1),
  })
  .strict();

const panoramaRuntimeSourceGeometryConfidenceSchema = z
  .object({
    column_confidence: z.number().min(0).max(1),
    overall_confidence: z.number().min(0).max(1),
    row_confidence: z.number().min(0).max(1),
  })
  .strict();

const panoramaSourceGeometrySelectionSchema = z
  .object({
    sourceCount: z.number().int().positive(),
    sourceIndices: z.array(z.number().int().nonnegative()),
  })
  .strict();

const panoramaRuntimeSourceGeometrySelectionSchema = z
  .object({
    source_count: z.number().int().positive(),
    source_indices: z.array(z.number().int().nonnegative()),
  })
  .strict();

const panoramaRenderedReviewSourceGeometrySchema = z
  .object({
    blockedReasons: z.array(z.string().trim().min(1)),
    columnCountEstimate: z.number().int().positive(),
    connectedComponentCount: z.number().int().positive(),
    graphConnectivity: panoramaSourceGeometryConnectivitySchema,
    horizontalSpanPx: z.number().int().nonnegative(),
    layout: z.enum(['grid_like', 'multi_row_candidate', 'single_row', 'unknown']),
    layoutConfidence: panoramaSourceGeometryConfidenceSchema,
    selectedComponent: panoramaSourceGeometrySelectionSchema,
    rowCountEstimate: z.number().int().positive(),
    support: z.enum(['blocked_requires_multi_row_solver', 'implemented_current_engine', 'unverified']),
    verticalSpanPx: z.number().int().nonnegative(),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

const panoramaManualCropInsetsSchema = z
  .object({
    bottom: z.number().min(0).max(40),
    left: z.number().min(0).max(40),
    right: z.number().min(0).max(40),
    top: z.number().min(0).max(40),
  })
  .strict()
  .superRefine((insets, context) => {
    if (insets.left + insets.right > 80) {
      context.addIssue({ code: 'custom', message: 'Horizontal crop insets cannot remove more than 80%.' });
    }
    if (insets.top + insets.bottom > 80) {
      context.addIssue({ code: 'custom', message: 'Vertical crop insets cannot remove more than 80%.' });
    }
  });

export const panoramaUiSettingsSchema = z
  .object({
    blendMode: panoramaUiBlendModeSchema,
    boundaryMode: panoramaUiBoundaryModeSchema,
    exposureMode: panoramaUiExposureModeSchema,
    manualCropInsetsPercent: panoramaManualCropInsetsSchema,
    maxPreviewDimensionPx: z.number().int().positive().max(8192),
    overlapFeatherPx: z.number().int().min(0).max(512),
    projection: panoramaUiProjectionSchema,
    qualityPreference: panoramaUiQualityPreferenceSchema,
    seamExposureCompensationPercent: z.number().int().min(0).max(100),
    sourceMode: z.literal('overlap_sequence'),
  })
  .strict();

export type PanoramaUiSettings = z.infer<typeof panoramaUiSettingsSchema>;
export type PanoramaUiProjection = z.infer<typeof panoramaUiProjectionSchema>;
export type PanoramaUiBoundaryMode = z.infer<typeof panoramaUiBoundaryModeSchema>;
export type PanoramaUiBlendMode = z.infer<typeof panoramaUiBlendModeSchema>;
export type PanoramaUiExposureMode = z.infer<typeof panoramaUiExposureModeSchema>;
export type PanoramaUiQualityPreference = z.infer<typeof panoramaUiQualityPreferenceSchema>;

const panoramaPlanDimensionsSchema = z
  .object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  })
  .strict();

const panoramaBoundaryFillColorSchema = z
  .object({
    alpha: z.number().min(0).max(1),
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const panoramaPlanMemoryComponentsSchema = z
  .object({
    low_detail_mask_bytes: z.number().int().nonnegative(),
    output_canvas_bytes: z.number().int().nonnegative(),
    output_mask_bytes: z.number().int().nonnegative(),
    overhead_bytes: z.number().int().nonnegative(),
    preview_bytes: z.number().int().nonnegative(),
    seam_workspace_bytes: z.number().int().nonnegative(),
    source_decode_bytes: z.number().int().nonnegative(),
    total_estimated_peak_bytes: z.number().int().nonnegative(),
  })
  .strict();

export const panoramaRuntimePlanSchema = z
  .object({
    dry_run: z.literal(true),
    family: z.literal('panorama'),
    output_dimensions: panoramaPlanDimensionsSchema,
    preflight: z
      .object({
        blocked_reasons: z.array(z.string()),
        execution_mode: z.string(),
        memory_budget_bytes: z.number().int().positive(),
        memory_budget_ratio: z.number().nonnegative(),
        memory_components: panoramaPlanMemoryComponentsSchema,
        source_geometry: z
          .object({
            blocked_reasons: z.array(z.string()),
            column_count_estimate: z.number().int().positive(),
            connected_component_count: z.number().int().positive(),
            graph_connectivity: panoramaRuntimeSourceGeometryConnectivitySchema,
            horizontal_span_px: z.number().int().nonnegative(),
            layout: z.enum(['grid_like', 'multi_row_candidate', 'single_row', 'unknown']),
            layout_confidence: panoramaRuntimeSourceGeometryConfidenceSchema,
            selected_component: panoramaRuntimeSourceGeometrySelectionSchema,
            row_count_estimate: z.number().int().positive(),
            support: z.enum(['blocked_requires_multi_row_solver', 'implemented_current_engine', 'unverified']),
            vertical_span_px: z.number().int().nonnegative(),
            warning_codes: z.array(z.string()),
          })
          .strict()
          .optional(),
        status: panoramaRuntimePlanStatusSchema,
        tile_count: z.number().int().positive(),
        warning_codes: z.array(z.string()),
      })
      .loose(),
    source_image_refs: z.array(z.object({ image_path: z.string(), source_index: z.number().int() }).loose()),
    warnings: z.array(z.string()),
  })
  .loose();

export type PanoramaRuntimePlan = z.infer<typeof panoramaRuntimePlanSchema>;

const panoramaRenderedReviewCropSchema = z
  .object({
    height: z.number().int().positive(),
    mode: z.string().min(1),
    preCropHeight: z.number().int().positive(),
    preCropWidth: z.number().int().positive(),
    width: z.number().int().positive(),
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

const panoramaRenderedReviewSourcesSchema = z
  .object({
    excludedSourceIndices: z.array(z.number().int().nonnegative()),
    stitchedSourceIndices: z.array(z.number().int().nonnegative()),
    totalCount: z.number().int().nonnegative(),
  })
  .strict();

const panoramaSeamReviewSchema = z
  .object({
    contributionMapArtifactId: z.string().trim().min(1).optional(),
    policy: z.literal('adaptive_dp_feather_v1'),
    reviewStatus: z.enum(['ready', 'requires_review']),
    seamCount: z.number().int().nonnegative(),
    seamMaskArtifactId: z.string().trim().min(1).optional(),
    overlapConfidence: z
      .object({
        edgeCount: z.number().int().nonnegative(),
        level: z.enum(['high', 'medium', 'low', 'blocked']),
        meanConfidenceScore: z.number().min(0).max(1),
        minimumConfidenceScore: z.number().min(0).max(1),
        minimumOverlapRatio: z.number().min(0).max(1),
        weakEdgeCount: z.number().int().nonnegative(),
      })
      .strict(),
    seams: z.array(
      z
        .object({
          confidence: z.enum(['high', 'medium', 'low']),
          featherWidthPx: z.number().int().positive(),
          fromSourceIndex: z.number().int().nonnegative(),
          p95ErrorPx: z.number().nonnegative(),
          toSourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    seamWarningState: z
      .object({
        parallaxRisk: z.enum(['low', 'medium', 'high']),
        state: z.enum(['clear', 'warning', 'blocked']),
        warningCodes: z.array(z.string().trim().min(1)),
      })
      .strict(),
  })
  .strict();

const panoramaSourceContributionSchema = z
  .object({
    excludedSourceCount: z.number().int().nonnegative(),
    regions: z.array(
      z
        .object({
          coverageRatio: z.number().min(0).max(1),
          role: z.enum(['stitched', 'excluded']),
          sourceIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    stitchedSourceCount: z.number().int().nonnegative(),
  })
  .strict();

const panoramaExposureNormalizationSummarySchema = z
  .object({
    appliedGainCount: z.number().int().nonnegative(),
    appliedLuminanceGains: z
      .array(
        z
          .object({
            gain: z.number().positive(),
            sourceIndex: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .default([]),
    compensationStrengthPercent: z.number().int().min(0).max(100).optional(),
    medianLogLuminanceDeltaAfter: z.number().nonnegative().optional(),
    medianLogLuminanceDeltaBefore: z.number().nonnegative().optional(),
    mode: z.enum(['scalar_overlap_luminance_gain_v1', 'none']),
  })
  .strict();

const panoramaSavedReviewSourceRefSchema = z
  .object({
    contentHash: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    path: z.string().trim().min(1),
    sourceIndex: z.number().int().nonnegative(),
  })
  .strict();

export const panoramaRenderedReviewSchema = z
  .object({
    boundary: z
      .object({
        crop: panoramaRenderedReviewCropSchema,
        effective: panoramaUiBoundaryModeSchema,
        fillColor: panoramaBoundaryFillColorSchema.optional(),
        requested: panoramaUiBoundaryModeSchema,
      })
      .strict(),
    capabilityLevel: z.literal('runtime_apply_capable'),
    outputDimensions: panoramaPlanDimensionsSchema,
    projection: z
      .object({
        effective: panoramaUiProjectionSchema,
        requested: panoramaUiProjectionSchema,
      })
      .strict(),
    seamReview: panoramaSeamReviewSchema,
    sourceGeometry: panoramaRenderedReviewSourceGeometrySchema,
    sources: panoramaRenderedReviewSourcesSchema,
    sourceContribution: panoramaSourceContributionSchema,
    exposureNormalizationSummary: panoramaExposureNormalizationSummarySchema,
    warningCodes: z.array(z.string()),
  })
  .strict();

export type PanoramaRenderedReview = z.infer<typeof panoramaRenderedReviewSchema>;

export const panoramaSavedReviewSummarySchema = z
  .object({
    boundaryFillColor: panoramaBoundaryFillColorSchema.optional(),
    boundaryMode: panoramaUiBoundaryModeSchema,
    capabilityLevel: z.literal('runtime_apply_capable'),
    crop: panoramaRenderedReviewCropSchema,
    exposureNormalizationSummary: panoramaExposureNormalizationSummarySchema,
    outputDimensions: panoramaPlanDimensionsSchema,
    outputPath: z.string().min(1),
    projection: panoramaUiProjectionSchema,
    seamReview: panoramaSeamReviewSchema,
    sourceGeometry: panoramaRenderedReviewSourceGeometrySchema,
    sourceCount: z.number().int().nonnegative(),
    sourceContribution: panoramaSourceContributionSchema,
    sourceRefs: z.array(panoramaSavedReviewSourceRefSchema),
    warningCodes: z.array(z.string()),
  })
  .strict()
  .superRefine((summary, context) => {
    if (summary.sourceRefs.length !== summary.sourceCount) {
      context.addIssue({
        code: 'custom',
        message: 'Panorama saved review sourceRefs length must match sourceCount.',
        path: ['sourceRefs'],
      });
    }
  });

export type PanoramaSavedReviewSummary = z.infer<typeof panoramaSavedReviewSummarySchema>;

export const DEFAULT_PANORAMA_UI_SETTINGS = panoramaUiSettingsSchema.parse({
  blendMode: 'multi_band',
  boundaryMode: 'auto_crop',
  exposureMode: 'gain_compensation',
  manualCropInsetsPercent: {
    bottom: 0,
    left: 0,
    right: 0,
    top: 0,
  },
  maxPreviewDimensionPx: 4096,
  overlapFeatherPx: 64,
  projection: 'rectilinear',
  qualityPreference: 'best',
  seamExposureCompensationPercent: 100,
  sourceMode: 'overlap_sequence',
});

export const normalizePanoramaUiSettings = (value: unknown): PanoramaUiSettings => {
  const parsed = panoramaUiSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_PANORAMA_UI_SETTINGS;
};
