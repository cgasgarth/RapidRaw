import { z } from 'zod';

const featureFamilySchema = z.enum(['panorama_stitch', 'focus_stack', 'super_resolution']);
const proofStatusSchema = z.enum([
  'manifest_only',
  'pending_private_assets',
  'runtime_apply_capable',
  'e2e_verified_private_assets',
]);
const proofLevelSchema = z.enum(['manifest_only', 'synthetic_runtime', 'private_runtime_apply', 'private_raw_e2e']);
const metricNameSchema = z.enum([
  'alignmentInlierRatio',
  'edgeContinuityScore',
  'focusTransitionArtifactScore',
  'sharpnessGainRatio',
  'superResolutionDetailGainRatio',
  'previewExportMeanAbsDelta',
]);

const nonClaimSchema = z.enum([
  'not_raw_decode_verified',
  'not_ui_e2e_verified',
  'not_export_parity_verified',
  'not_quality_accepted',
]);

const reviewSourceSetSchema = z
  .object({
    expectedRawFormat: z.string().trim().min(2),
    sourceCount: z.number().int().positive(),
    sourceIndices: z.array(z.number().int().nonnegative()).min(1),
    sourcePaths: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

const reviewRuntimePlanSchema = z
  .object({
    commandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    planHash: z.string().trim().min(1),
    planId: z.string().trim().min(1),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

const reviewApplyResultSchema = z
  .object({
    commandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    outputArtifactId: z.string().trim().min(1),
    previewArtifactId: z.string().trim().min(1),
    resultId: z.string().trim().min(1),
  })
  .strict();

const reviewMetricSchema = z
  .object({
    name: metricNameSchema,
    passed: z.boolean(),
    source: z.enum(['synthetic_runtime', 'private_raw_report']),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const reviewArtifactHandleSchema = z
  .object({
    id: z.string().trim().min(1),
    kind: z.enum(['preview', 'output', 'alignment_report', 'quality_report', 'confidence_map', 'retouch_layer']),
    source: z.enum(['synthetic_runtime', 'private_raw_report']),
  })
  .strict();

const reviewPanelDiagnosticSchema = z
  .object({
    applyResult: reviewApplyResultSchema.nullable(),
    artifactHandles: z.array(reviewArtifactHandleSchema),
    dryRunPlan: reviewRuntimePlanSchema.nullable(),
    featureFamily: featureFamilySchema,
    fixtureId: z.string().regex(/^validation\.computational-merge\.[a-z0-9.-]+\.v[0-9]+$/u),
    implementationIssue: z.number().int().positive(),
    nonClaims: z.array(nonClaimSchema).min(1),
    proofLevel: proofLevelSchema,
    proofStatus: proofStatusSchema,
    qualityMetrics: z.array(reviewMetricSchema),
    sourceSet: reviewSourceSetSchema,
    uiIssue: z.number().int().positive(),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((diagnostic, context) => {
    if (diagnostic.proofLevel !== 'manifest_only') {
      if (diagnostic.dryRunPlan === null) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime proof levels require dry-run diagnostics.',
          path: ['dryRunPlan'],
        });
      }
      if (diagnostic.applyResult === null) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime proof levels require apply-result diagnostics.',
          path: ['applyResult'],
        });
      }
    }

    if (diagnostic.proofLevel !== 'private_raw_e2e') {
      const nonClaims = new Set(diagnostic.nonClaims);
      for (const required of ['not_raw_decode_verified', 'not_ui_e2e_verified', 'not_quality_accepted'] as const) {
        if (!nonClaims.has(required)) {
          context.addIssue({
            code: 'custom',
            message: `Non-private-RAW proof must declare ${required}.`,
            path: ['nonClaims'],
          });
        }
      }
    }
  });

export const computationalMergeReviewPanelDiagnosticCollectionSchema = z
  .object({
    diagnostics: z.array(reviewPanelDiagnosticSchema).min(3),
    issue: z.literal(1819),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((collection, context) => {
    const fixtureIds = collection.diagnostics.map((diagnostic) => diagnostic.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Review diagnostics fixture IDs must be unique.',
        path: ['diagnostics'],
      });
    }

    const families = new Set(collection.diagnostics.map((diagnostic) => diagnostic.featureFamily));
    for (const family of featureFamilySchema.options) {
      if (!families.has(family)) {
        context.addIssue({
          code: 'custom',
          message: `Review diagnostics require ${family}.`,
          path: ['diagnostics'],
        });
      }
    }
  });

export type ComputationalMergeReviewPanelDiagnosticCollection = z.infer<
  typeof computationalMergeReviewPanelDiagnosticCollectionSchema
>;
