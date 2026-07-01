import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const featureFamilySchema = z.enum(['hdr_merge', 'panorama_stitch', 'focus_stack', 'super_resolution']);

const artifactKindSchema = z.enum([
  'source_raw_sequence_private',
  'decode_report_private',
  'alignment_report_private',
  'merge_output_private',
  'preview_after_private',
  'export_after_private',
  'quality_report_private',
  'app_server_runtime_report_private',
]);

const metricNameSchema = z.enum([
  'alignmentAcceptedPairCount',
  'alignmentFiniteTransformCount',
  'alignmentInlierCount',
  'alignmentInlierRatio',
  'alignmentMatchCount',
  'alignmentMeanReprojectionErrorPx',
  'alignmentMeanSymmetricTransferErrorPx',
  'alignmentRejectedPairCount',
  'decodedFinitePixelRatio',
  'decodedNonzeroDimensionCount',
  'decodedSourceCount',
  'edgeContinuityScore',
  'exposureBracketCoverageEv',
  'focusTransitionArtifactScore',
  'focusStackLowConfidenceCellRatio',
  'focusStackOutputPixelCount',
  'focusStackSourceCoverageRatio',
  'focusStackWinnerSourceCount',
  'ghostSuppressionScore',
  'highlightRecoveryRatio',
  'panoramaExcludedSourceCount',
  'panoramaOutputPixelCount',
  'panoramaOutputSourceCoverageRatio',
  'panoramaPairwiseMatchCount',
  'panoramaStitchedSourceCount',
  'sharpnessGainRatio',
  'superResolutionDetailGainRatio',
  'superResolutionArtifactScore',
  'superResolutionOutputPixelCount',
  'superResolutionRegistrationResidualPx',
  'superResolutionSourceCoverageRatio',
  'previewExportMeanAbsDelta',
]);

const nonEmptyIdSchema = z.string().trim().min(1);
const privatePathSchema = z
  .string()
  .trim()
  .regex(/^(private-fixtures|private-artifacts)\//u);

const hashedPathSchema = z
  .object({
    hash: sha256Schema,
    path: privatePathSchema,
    publicRepoAllowed: z.literal(false),
  })
  .strict();

const sourceHashSchema = hashedPathSchema.extend({
  localRelativePath: privatePathSchema,
  path: privatePathSchema.optional(),
});

const runArtifactSchema = hashedPathSchema.extend({
  kind: artifactKindSchema,
});

const screenshotArtifactSchema = hashedPathSchema.extend({
  label: z.enum(['modal_before_apply', 'modal_after_apply', 'result_review', 'export_review']),
});

const qualityMetricSchema = z
  .object({
    name: metricNameSchema,
    passed: z.literal(true),
    source: z.literal('private_raw_report'),
    threshold: z.number().min(0),
    value: z.number().min(0),
  })
  .strict();

const commandIdsSchema = z
  .object({
    apply: nonEmptyIdSchema,
    dryRun: nonEmptyIdSchema,
  })
  .strict();

const runtimeResultIdsSchema = z
  .object({
    apply: nonEmptyIdSchema,
    dryRun: nonEmptyIdSchema,
  })
  .strict();

const superResolutionRealPhotoQualityReadoutSchema = z
  .object({
    artifactScore: z.number().min(0),
    downscaleReconstructionError: z.number().min(0).optional(),
    detailGainRatio: z.number().min(0),
    effectiveScale: z.number().min(1).max(4).optional(),
    falseDetailRisk: z.enum(['unknown', 'low', 'medium', 'high']).optional(),
    falseDetailRiskScore: z.number().min(0).max(1).optional(),
    outputArtifactHash: sha256Schema,
    outputArtifactPath: privatePathSchema,
    outputPixelCount: z.number().int().positive(),
    registrationResidualPx: z.number().min(0),
    sourceCount: z.number().int().min(2),
    sourceCoverageRatio: z.number().min(0).max(1),
    weakSupportRatio: z.number().min(0).max(1).optional(),
  })
  .strict();

const privateRunReportSchema = z
  .object({
    acceptanceStatus: z.enum([
      'private_decode_smoke',
      'private_alignment_smoke',
      'private_focus_stack_artifact_smoke',
      'private_stitch_artifact_smoke',
      'private_preview_export_smoke',
      'private_reconstruction_artifact_smoke',
      'runtime_apply_capable',
      'passed_private_raw_e2e',
    ]),
    artifacts: z.array(runArtifactSchema).min(3),
    commandIds: commandIdsSchema.optional(),
    featureFamily: featureFamilySchema,
    fixtureId: z.string().regex(/^validation\.computational-merge\.[a-z0-9.-]+\.v[0-9]+$/u),
    generatedAt: z.iso.datetime(),
    graphRevisionHash: sha256Schema,
    implementationIssue: z.number().int().positive(),
    notes: z.string().trim().min(1),
    previewExportParity: qualityMetricSchema
      .extend({
        name: z.literal('previewExportMeanAbsDelta'),
      })
      .optional(),
    qualityMetrics: z.array(qualityMetricSchema).min(2),
    reportId: z.string().regex(/^computational-merge-run\.[a-z0-9.-]+\.v[0-9]+$/u),
    runId: z.string().trim().min(1).optional(),
    runtimeResultIds: runtimeResultIdsSchema.optional(),
    screenshotArtifacts: z.array(screenshotArtifactSchema),
    sourceHashes: z.array(sourceHashSchema).min(2),
    superResolutionQualityReadout: superResolutionRealPhotoQualityReadoutSchema.optional(),
    uiIssue: z.number().int().positive(),
  })
  .strict()
  .superRefine((report, context) => {
    const artifactKinds = report.artifacts.map((artifact) => artifact.kind);
    if (new Set(artifactKinds).size !== artifactKinds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Run report artifact kinds must be unique.',
        path: ['artifacts'],
      });
    }

    const requiredDecodeArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'quality_report_private',
    ] as const;
    const requiredAlignmentArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'quality_report_private',
    ] as const;
    const forbiddenDecodeArtifacts = ['merge_output_private', 'preview_after_private', 'export_after_private'] as const;
    const requiredStitchArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'merge_output_private',
      'quality_report_private',
    ] as const;
    const forbiddenStitchArtifacts = ['preview_after_private', 'export_after_private'] as const;
    const requiredReconstructionArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'merge_output_private',
      'quality_report_private',
    ] as const;
    const forbiddenReconstructionArtifacts = ['preview_after_private', 'export_after_private'] as const;
    const requiredPreviewExportArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'merge_output_private',
      'preview_after_private',
      'export_after_private',
      'quality_report_private',
    ] as const;
    const requiredFocusStackArtifacts = [
      'source_raw_sequence_private',
      'decode_report_private',
      'alignment_report_private',
      'merge_output_private',
      'quality_report_private',
    ] as const;
    if (
      report.acceptanceStatus === 'private_decode_smoke' &&
      (report.featureFamily === 'panorama_stitch' ||
        report.featureFamily === 'focus_stack' ||
        report.featureFamily === 'super_resolution')
    ) {
      for (const artifactKind of requiredDecodeArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private decode smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      for (const artifactKind of forbiddenDecodeArtifacts) {
        if (artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private decode smoke report must not claim ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else if (report.acceptanceStatus === 'private_alignment_smoke' && report.featureFamily === 'panorama_stitch') {
      for (const artifactKind of requiredAlignmentArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private alignment smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      for (const artifactKind of forbiddenDecodeArtifacts) {
        if (artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private alignment smoke report must not claim ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else if (
      report.acceptanceStatus === 'private_stitch_artifact_smoke' &&
      report.featureFamily === 'panorama_stitch'
    ) {
      for (const artifactKind of requiredStitchArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private stitch artifact smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      for (const artifactKind of forbiddenStitchArtifacts) {
        if (artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private stitch artifact smoke report must not claim ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else if (
      report.acceptanceStatus === 'private_reconstruction_artifact_smoke' &&
      report.featureFamily === 'super_resolution'
    ) {
      for (const artifactKind of requiredReconstructionArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private reconstruction artifact smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      for (const artifactKind of forbiddenReconstructionArtifacts) {
        if (artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private reconstruction artifact smoke report must not claim ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else if (report.acceptanceStatus === 'private_preview_export_smoke') {
      for (const artifactKind of requiredPreviewExportArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private preview/export smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else if (
      report.acceptanceStatus === 'private_focus_stack_artifact_smoke' &&
      report.featureFamily === 'focus_stack'
    ) {
      for (const artifactKind of requiredFocusStackArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private focus stack artifact smoke report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      for (const artifactKind of forbiddenStitchArtifacts) {
        if (artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Private focus stack artifact smoke report must not claim ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
    } else {
      const requiresPreviewExportParity =
        report.acceptanceStatus === 'passed_private_raw_e2e' ||
        report.featureFamily === 'hdr_merge' ||
        report.featureFamily === 'panorama_stitch';
      const requiredRuntimeArtifacts = [
        'source_raw_sequence_private',
        'alignment_report_private',
        'merge_output_private',
        'quality_report_private',
        'app_server_runtime_report_private',
        ...(requiresPreviewExportParity ? (['preview_after_private', 'export_after_private'] as const) : []),
      ] as const;
      for (const artifactKind of requiredRuntimeArtifacts) {
        if (!artifactKinds.includes(artifactKind)) {
          context.addIssue({
            code: 'custom',
            message: `Runtime/E2E private run report requires ${artifactKind}.`,
            path: ['artifacts'],
          });
        }
      }
      if (report.commandIds === undefined) {
        context.addIssue({ code: 'custom', message: 'Runtime/E2E report requires commandIds.', path: ['commandIds'] });
      }
      if (report.runtimeResultIds === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime/E2E report requires runtimeResultIds.',
          path: ['runtimeResultIds'],
        });
      }
      if (requiresPreviewExportParity && report.previewExportParity === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime/E2E report requires previewExportParity.',
          path: ['previewExportParity'],
        });
      }
      if (report.screenshotArtifacts.length < 2) {
        context.addIssue({
          code: 'custom',
          message: 'Runtime/E2E report requires at least two screenshot artifacts.',
          path: ['screenshotArtifacts'],
        });
      }
      if (
        report.featureFamily === 'super_resolution' &&
        report.acceptanceStatus === 'runtime_apply_capable' &&
        report.superResolutionQualityReadout === undefined
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Super-resolution runtime reports require a real-photo quality readout.',
          path: ['superResolutionQualityReadout'],
        });
      }
    }

    const sourcePaths = report.sourceHashes.map((source) => source.localRelativePath);
    if (new Set(sourcePaths).size !== sourcePaths.length) {
      context.addIssue({
        code: 'custom',
        message: 'Run report source hashes must use unique source paths.',
        path: ['sourceHashes'],
      });
    }
  });

export const computationalMergePrivateRunReportCollectionSchema = z
  .object({
    $schema: z.url(),
    issue: z.literal(1817),
    reports: z.array(privateRunReportSchema),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
    validationMode: z.literal('public_schema_private_reports'),
  })
  .strict()
  .superRefine((collection, context) => {
    const reportIds = collection.reports.map((report) => report.reportId);
    if (new Set(reportIds).size !== reportIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Private run report IDs must be unique.',
        path: ['reports'],
      });
    }

    const fixtureIds = collection.reports.map((report) => report.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Only one private run report is allowed per fixture.',
        path: ['reports'],
      });
    }
  });

export type ComputationalMergePrivateRunReportCollection = z.infer<
  typeof computationalMergePrivateRunReportCollectionSchema
>;

export function parseComputationalMergePrivateRunReportCollection(
  value: unknown,
): ComputationalMergePrivateRunReportCollection {
  return computationalMergePrivateRunReportCollectionSchema.parse(value);
}
