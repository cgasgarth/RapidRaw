import { z } from 'zod';

import { proofContractSchema } from '../proofLevelSemanticsSchemas.ts';

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const namespacedHashSchema = z.string().regex(/^(fnv1a32|sha256):[a-f0-9]+$/u);
const artifactKindSchema = z.enum(['before_crop', 'after_crop', 'diff_heatmap', 'contact_sheet', 'metric_report']);
const sourceKindSchema = z.enum(['public_raw', 'public_real_derived_crop', 'private_raw', 'synthetic_control']);
const executionStatusSchema = z.enum(['applied_nind_runtime', 'unavailable_provider', 'dry_run_only', 'schema_only']);
const closureStatusSchema = z.enum(['harness_only', 'eligible_real_run']);
const doesNotProveSchema = z.enum([
  'full_quality_closure',
  'independent_preview_export_paths',
  'provider_availability',
  'real_raw_quality',
  'two_real_derived_nind_runs',
]);

const metricSchema = z
  .object({
    edgeContrastRatio: z.number().positive().nullable(),
    highPassCorrelation: z.number().min(-1).max(1).nullable(),
    lowFrequencyChromaMad: z.number().nonnegative().nullable(),
    lumaTextureEnergyRatio: z.number().nonnegative().nullable(),
    maxDeltaE00: z.number().nonnegative().nullable(),
    meanLumaShift: z.number().nullable(),
    tileSeamMaxDelta: z.number().nonnegative().nullable(),
    unsupportedOutputEdgeFraction: z.number().min(0).max(1).nullable(),
  })
  .strict();

const artifactSchema = z
  .object({
    hash: hashSchema,
    kind: artifactKindSchema,
    path: z.string().trim().min(1),
    role: z.string().trim().min(1),
  })
  .strict();

const cropSchema = z
  .object({
    artifacts: z.array(artifactSchema),
    cropId: z.string().trim().min(1),
    executionStatus: executionStatusSchema,
    fixtureId: z.string().trim().min(1),
    metrics: metricSchema,
    model: z
      .object({
        id: z.literal('nind_denoise_utnet_684.onnx'),
        sha256: hashSchema.nullable(),
        sourceUrl: z.url(),
      })
      .strict(),
    outputContentHash: namespacedHashSchema.nullable(),
    referenceKind: z.enum(['none', 'low_iso_match', 'burst_average']),
    source: z
      .object({
        attribution: z.string().trim().min(1),
        fixtureSourceHash: hashSchema.nullable(),
        kind: sourceKindSchema,
        license: z.string().trim().min(1),
        sourceUrl: z.url().nullable(),
      })
      .strict(),
  })
  .strict();

export const aiDenoiseQualityReportSchema = z
  .object({
    doesNotProve: z.array(doesNotProveSchema).min(5),
    generatedAt: z.iso.datetime({ offset: true }),
    issue: z.literal(1267),
    limitation: z.string().trim().min(1),
    minEligibleRealRunsRequired: z.literal(2),
    proofEntrypoints: z
      .object({
        report: z.literal('check-ai-denoise-quality-proof'),
        runtime: z.literal('ai_processing::run_ai_denoise'),
      })
      .strict(),
    proofHash: hashSchema,
    proofLevel: z.literal('runtime_quality_harness'),
    runtimeStatus: z.literal('synthetic_runtime_harness_only'),
    schemaVersion: z.literal(1),
    status: closureStatusSchema,
    validationCrops: z.array(cropSchema).min(1),
  })
  .strict()
  .superRefine((report, context) => {
    const contract = proofContractSchema.safeParse(report);
    if (!contract.success) {
      for (const issue of contract.error.issues) {
        context.addIssue({
          code: 'custom',
          message: issue.message,
          path: issue.path,
        });
      }
    }

    for (const nonClaim of [
      'full_quality_closure',
      'independent_preview_export_paths',
      'provider_availability',
      'real_raw_quality',
      'two_real_derived_nind_runs',
    ] as const) {
      if (!report.doesNotProve.includes(nonClaim)) {
        context.addIssue({
          code: 'custom',
          message: `AI denoise quality report must explicitly avoid claiming ${nonClaim}.`,
          path: ['doesNotProve'],
        });
      }
    }

    const eligibleRuns = report.validationCrops.filter(isEligibleRealRun);
    if (report.status === 'eligible_real_run' && eligibleRuns.length < report.minEligibleRealRunsRequired) {
      context.addIssue({
        code: 'custom',
        message: `eligible_real_run requires at least ${report.minEligibleRealRunsRequired} applied real NIND crops.`,
        path: ['status'],
      });
    }
  });

export type AiDenoiseQualityReport = z.infer<typeof aiDenoiseQualityReportSchema>;
export type AiDenoiseQualityCrop = AiDenoiseQualityReport['validationCrops'][number];

export function isEligibleRealRun(crop: AiDenoiseQualityCrop): boolean {
  return (
    crop.executionStatus === 'applied_nind_runtime' &&
    (crop.source.kind === 'public_real_derived_crop' ||
      crop.source.kind === 'private_raw' ||
      crop.source.kind === 'public_raw') &&
    crop.artifacts.some((artifact) => artifact.kind === 'before_crop') &&
    crop.artifacts.some((artifact) => artifact.kind === 'after_crop') &&
    crop.artifacts.some((artifact) => artifact.kind === 'diff_heatmap') &&
    crop.artifacts.some((artifact) => artifact.kind === 'contact_sheet') &&
    crop.outputContentHash !== null
  );
}

export const parseAiDenoiseQualityReport = (value: unknown): AiDenoiseQualityReport =>
  aiDenoiseQualityReportSchema.parse(value);
