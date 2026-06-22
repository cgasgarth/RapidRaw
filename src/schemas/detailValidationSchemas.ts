import { z } from 'zod';

const positiveIntegerSchema = z.number().int().positive();
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const detailStageKindSchema = z.enum([
  'raw_decode',
  'demosaic',
  'scene_linear_denoise',
  'scene_linear_deblur',
  'capture_sharpen',
  'local_contrast',
  'tone_display_transform',
  'output_sharpen',
  'export_encode',
]);

export const detailRuntimeStateSchema = z.enum([
  'contract_only',
  'validation_only',
  'cpu_reference_only',
  'preview_only',
  'preview_export_parity',
  'ui_api_wired',
  'e2e_proven',
]);

export const detailLimitationSchema = z.enum([
  'e2e_workflow',
  'gpu_parity',
  'preview_export_parity',
  'real_raw_quality',
  'ui_api_wiring',
]);

export const detailOutputComparisonLimitationSchema = z.enum([
  'native_export_pipeline',
  'real_raw_quality',
  'tauri_app_e2e',
  'user_tuned_recipe_quality',
]);

export const detailOutputComparisonWarningSchema = z.enum([
  'crop_bounds_ok',
  'fallback_render_mode_review',
  'halo_risk_review',
  'oversmoothing_review',
]);

export const detailPreviewExportParityClaimSchema = z.enum([
  'disabled_noop_parity',
  'enabled_synthetic_parity',
  'export_intent_separated',
]);

export const detailPreviewExportParityLimitationSchema = z.enum([
  'e2e_workflow',
  'gpu_parity',
  'real_app_pipeline',
  'real_raw_quality',
]);

export const detailPreviewExportParityCaseSchema = z
  .object({
    caseId: z.string().regex(/^detail\.[a-z0-9.-]+\.v[0-9]+$/u),
    claim: detailPreviewExportParityClaimSchema,
    doesNotProve: z.array(detailPreviewExportParityLimitationSchema).min(1),
    exportPath: z.enum(['shared_detail_stage', 'output_intent_stage']),
    feature: z.enum(['capture_sharpen', 'output_sharpen']),
    maxAllowedChannelDiff: z.number().min(0).max(0.01),
    minRequiredPixelDelta: z.number().min(0).max(0.5),
    previewPath: z.literal('shared_detail_stage'),
    sourceIssue: z.literal(1150),
    stage: detailStageKindSchema,
    syntheticFixture: z
      .object({
        height: z.number().int().min(5).max(128),
        leftValue: z.number().min(0).max(1),
        pattern: z.literal('vertical_edge'),
        rightValue: z.number().min(0).max(1),
        width: z.number().int().min(5).max(128),
      })
      .strict(),
    tuning: z
      .object({
        amount: z.number().min(0).max(1.5),
        radiusPx: z.number().min(0.3).max(3),
        threshold: z.number().min(0).max(1),
      })
      .strict(),
  })
  .strict();

export const detailPreviewExportParityManifestSchema = z
  .object({
    $schema: z.url(),
    cases: z.array(detailPreviewExportParityCaseSchema).min(2),
    issue: z.literal(1150),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const caseIds = new Set<string>();
    let hasDisabledNoop = false;
    let hasEnabledSynthetic = false;

    for (const [index, parityCase] of manifest.cases.entries()) {
      if (caseIds.has(parityCase.caseId)) {
        context.addIssue({
          code: 'custom',
          message: 'Detail parity case IDs must be unique.',
          path: ['cases', index, 'caseId'],
        });
      }
      caseIds.add(parityCase.caseId);

      if (!parityCase.doesNotProve.includes('real_app_pipeline')) {
        context.addIssue({
          code: 'custom',
          message: 'Synthetic parity cases must not imply full app pipeline proof.',
          path: ['cases', index, 'doesNotProve'],
        });
      }

      if (parityCase.claim === 'disabled_noop_parity') {
        hasDisabledNoop = true;
        if (parityCase.minRequiredPixelDelta !== 0 || parityCase.tuning.amount !== 0) {
          context.addIssue({
            code: 'custom',
            message: 'Disabled no-op parity cases must not require a pixel delta.',
            path: ['cases', index],
          });
        }
      }

      if (parityCase.claim === 'enabled_synthetic_parity') {
        hasEnabledSynthetic = true;
        if (parityCase.exportPath !== 'shared_detail_stage' || parityCase.minRequiredPixelDelta <= 0) {
          context.addIssue({
            code: 'custom',
            message: 'Enabled synthetic parity cases must use the shared detail stage and require a pixel delta.',
            path: ['cases', index],
          });
        }
      }

      if (parityCase.claim === 'export_intent_separated') {
        if (parityCase.feature !== 'output_sharpen' || parityCase.exportPath !== 'output_intent_stage') {
          context.addIssue({
            code: 'custom',
            message: 'Export intent separation cases must be output-sharpen export-stage cases.',
            path: ['cases', index],
          });
        }
      }
    }

    if (!hasDisabledNoop) {
      context.addIssue({
        code: 'custom',
        message: 'Detail parity manifest must include a disabled no-op parity case.',
        path: ['cases'],
      });
    }

    if (!hasEnabledSynthetic) {
      context.addIssue({
        code: 'custom',
        message: 'Detail parity manifest must include an enabled synthetic parity case.',
        path: ['cases'],
      });
    }
  });

const detailOutputComparisonArtifactSchema = z
  .object({
    contentHash: sha256Schema,
    format: z.literal('pgm_u8_preview'),
    kind: z.enum([
      'current_baseline_crop',
      'disabled_export_artifact',
      'enabled_export_artifact',
      'original_crop',
      'recipe_preview_crop',
    ]),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.literal(false),
  })
  .strict();

export const detailOutputComparisonProofReportSchema = z
  .object({
    $schema: z.url(),
    artifacts: z
      .object({
        currentBaselineCrop: detailOutputComparisonArtifactSchema.extend({
          kind: z.literal('current_baseline_crop'),
        }),
        disabledExportArtifact: detailOutputComparisonArtifactSchema.extend({
          kind: z.literal('disabled_export_artifact'),
        }),
        enabledExportArtifact: detailOutputComparisonArtifactSchema.extend({
          kind: z.literal('enabled_export_artifact'),
        }),
        originalCrop: detailOutputComparisonArtifactSchema.extend({
          kind: z.literal('original_crop'),
        }),
        recipePreviewCrop: detailOutputComparisonArtifactSchema.extend({
          kind: z.literal('recipe_preview_crop'),
        }),
      })
      .strict(),
    crop: z
      .object({
        clipped: z.literal(false),
        height: z.number().int().positive(),
        sourcePath: z.string().trim().min(1),
        width: z.number().int().positive(),
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        zoomPercent: z.literal(100),
      })
      .strict(),
    doesNotProve: z.array(detailOutputComparisonLimitationSchema).min(1),
    fixtureId: z.literal('detail.output.high-iso-denoise-detail-100.v1'),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(3067),
    metrics: z
      .object({
        currentToRecipeChangedPixelRatio: z.number().gt(0.05).lte(1),
        currentToRecipeMeanAbsDelta: z.number().gt(0.005).lt(0.5),
        disabledExportMatchesCurrentHash: z.literal(true),
        enabledExportDiffersFromDisabled: z.literal(true),
        originalToCurrentMeanAbsDelta: z.number().gt(0.001).lt(0.5),
        recipeToExportMeanAbsDelta: z.number().min(0).max(0.002),
      })
      .strict(),
    recipe: z
      .object({
        deblurStrength: z.number().min(0).max(1),
        detailAmount: z.number().min(0).max(1),
        label: z.literal('Denoise + detail 100% review'),
        lumaNoiseReduction: z.number().min(0).max(1),
        recipeId: z.literal('detail.output.denoise-detail-100.v1'),
        stages: z.array(z.enum(['scene_linear_denoise', 'capture_sharpen', 'wavelet_luma_detail'])).length(3),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_detail_output_comparison_artifact_rendered'),
    schemaVersion: z.literal(1),
    warnings: z.array(detailOutputComparisonWarningSchema).min(2),
  })
  .strict()
  .superRefine((report, context) => {
    const warnings = new Set(report.warnings);
    for (const warning of ['halo_risk_review', 'oversmoothing_review'] as const) {
      if (!warnings.has(warning)) {
        context.addIssue({
          code: 'custom',
          message: `Detail output comparison proof must include ${warning}.`,
          path: ['warnings'],
        });
      }
    }

    if (report.artifacts.disabledExportArtifact.contentHash !== report.artifacts.currentBaselineCrop.contentHash) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled detail recipe export must match the current baseline crop hash.',
        path: ['artifacts', 'disabledExportArtifact', 'contentHash'],
      });
    }

    if (report.artifacts.enabledExportArtifact.contentHash === report.artifacts.disabledExportArtifact.contentHash) {
      context.addIssue({
        code: 'custom',
        message: 'Enabled detail recipe export must differ from the disabled export hash.',
        path: ['artifacts', 'enabledExportArtifact', 'contentHash'],
      });
    }
  });

export const detailOutputComparisonVisualProofSchema = z
  .object({
    comparisonMode: z.literal('original_current_recipe_export'),
    cropClipped: z.literal(false),
    cropZoomPercent: z.literal(100),
    deblurStrength: z.literal(0.7),
    denoiseLuma: z.literal(0.58),
    exportArtifactPath: z.string().endsWith('/high-iso-skin-shadow-v1-enabled-export.pgm'),
    fixtureId: z.literal('detail.output.high-iso-denoise-detail-100.v1'),
    recipeApplied: z.literal(true),
    recipeId: z.literal('detail.output.denoise-detail-100.v1'),
    renderFallback: z.literal(false),
    runtimeStatus: z.literal('synthetic_detail_output_comparison_artifact_rendered'),
    warningCodes: z.array(detailOutputComparisonWarningSchema).min(2),
  })
  .strict();

export const detailStageEntrySchema = z
  .object({
    order: positiveIntegerSchema,
    stage: detailStageKindSchema,
    status: detailRuntimeStateSchema,
    validates: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export const detailStageOrderManifestSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1174),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    stages: z.array(detailStageEntrySchema).min(5),
  })
  .strict()
  .superRefine((manifest, context) => {
    const expectedOrder = [
      'raw_decode',
      'demosaic',
      'scene_linear_denoise',
      'scene_linear_deblur',
      'capture_sharpen',
      'local_contrast',
      'tone_display_transform',
      'output_sharpen',
      'export_encode',
    ];

    const positions = new Map<string, number>();
    let previousOrder = 0;
    for (const [index, stage] of manifest.stages.entries()) {
      if (stage.order <= previousOrder) {
        context.addIssue({
          code: 'custom',
          message: 'Detail stage order values must be strictly increasing.',
          path: ['stages', index, 'order'],
        });
      }
      previousOrder = stage.order;

      if (positions.has(stage.stage)) {
        context.addIssue({
          code: 'custom',
          message: 'Detail stage entries must be unique.',
          path: ['stages', index, 'stage'],
        });
      }
      positions.set(stage.stage, stage.order);
    }

    for (const stage of expectedOrder) {
      if (!positions.has(stage)) {
        context.addIssue({
          code: 'custom',
          message: `Detail stage order must include ${stage}.`,
          path: ['stages'],
        });
      }
    }

    for (let index = 1; index < expectedOrder.length; index += 1) {
      const previousStage = expectedOrder[index - 1];
      const currentStage = expectedOrder[index];
      if (previousStage === undefined || currentStage === undefined) {
        continue;
      }
      const before = positions.get(previousStage);
      const after = positions.get(currentStage);
      if (before !== undefined && after !== undefined && before >= after) {
        context.addIssue({
          code: 'custom',
          message: `${previousStage} must run before ${currentStage}.`,
          path: ['stages'],
        });
      }
    }
  });

export const detailArtifactKindSchema = z.enum([
  'e2e_screenshot',
  'export_artifact',
  'metric_report',
  'preview_artifact',
  'private_raw_placeholder',
  'synthetic_after',
  'synthetic_before',
]);

export const detailArtifactEntrySchema = z
  .object({
    artifactId: z.string().regex(/^detail\.[a-z0-9.-]+\.v[0-9]+$/u),
    capabilityState: detailRuntimeStateSchema,
    feature: z.enum(['deblur', 'denoise', 'detail_stage_order']),
    hash: sha256Schema.nullable(),
    kind: detailArtifactKindSchema,
    limitations: z.array(detailLimitationSchema),
    path: z.string().trim().min(1),
    publicRepoAllowed: z.boolean(),
    sourceIssue: z.number().int().positive(),
  })
  .strict();

export const detailArtifactManifestSchema = z
  .object({
    $schema: z.url(),
    artifacts: z.array(detailArtifactEntrySchema).min(3),
    issue: z.literal(1174),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const artifactIds = new Set<string>();
    for (const [index, artifact] of manifest.artifacts.entries()) {
      if (artifactIds.has(artifact.artifactId)) {
        context.addIssue({
          code: 'custom',
          message: 'Detail artifact IDs must be unique.',
          path: ['artifacts', index, 'artifactId'],
        });
      }
      artifactIds.add(artifact.artifactId);

      if (artifact.kind === 'private_raw_placeholder' && artifact.publicRepoAllowed) {
        context.addIssue({
          code: 'custom',
          message: 'Private RAW placeholders must not be public repo artifacts.',
          path: ['artifacts', index, 'publicRepoAllowed'],
        });
      }

      if (artifact.capabilityState !== 'e2e_proven' && !artifact.limitations.includes('e2e_workflow')) {
        context.addIssue({
          code: 'custom',
          message: 'Non-E2E artifact states must keep e2e_workflow listed as a limitation.',
          path: ['artifacts', index, 'limitations'],
        });
      }

      if (
        !['preview_export_parity', 'e2e_proven'].includes(artifact.capabilityState) &&
        !artifact.limitations.includes('preview_export_parity')
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Artifacts before preview/export parity must list preview_export_parity as a limitation.',
          path: ['artifacts', index, 'limitations'],
        });
      }
    }
  });

export type DetailArtifactManifest = z.infer<typeof detailArtifactManifestSchema>;
export type DetailOutputComparisonProofReport = z.infer<typeof detailOutputComparisonProofReportSchema>;
export type DetailOutputComparisonVisualProof = z.infer<typeof detailOutputComparisonVisualProofSchema>;
export type DetailPreviewExportParityManifest = z.infer<typeof detailPreviewExportParityManifestSchema>;
export type DetailStageOrderManifest = z.infer<typeof detailStageOrderManifestSchema>;

export const parseDetailStageOrderManifest = (value: unknown): DetailStageOrderManifest =>
  detailStageOrderManifestSchema.parse(value);

export const parseDetailArtifactManifest = (value: unknown): DetailArtifactManifest =>
  detailArtifactManifestSchema.parse(value);

export const parseDetailOutputComparisonProofReport = (value: unknown): DetailOutputComparisonProofReport =>
  detailOutputComparisonProofReportSchema.parse(value);

export const parseDetailPreviewExportParityManifest = (value: unknown): DetailPreviewExportParityManifest =>
  detailPreviewExportParityManifestSchema.parse(value);
