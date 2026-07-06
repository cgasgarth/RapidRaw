import { z } from 'zod';

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const ratioSchema = z.number().min(0).max(1);

const focusPreviewBlendRegionMetricSchema = z
  .object({
    expectedSourceIndex: nonnegativeIntegerSchema,
    meanAbsoluteError: z.number().nonnegative(),
    regionId: z.string().regex(/^[a-z0-9-]+$/u),
    status: z.enum(['pass', 'fail']),
  })
  .strict();

const focusPreviewBlendFixtureReportSchema = z
  .object({
    artifactPath: z.string().min(1),
    blockCodes: z.array(z.enum(['stale_source_graph_revision'])),
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    haloRiskCellRatio: ratioSchema,
    height: positiveIntegerSchema.max(512),
    lowConfidenceCellRatio: ratioSchema,
    provenance: z
      .object({
        focusSharpnessIssue: z.literal(1061),
        manifestIssue: z.literal(1059),
        scaleCompensationApplied: z.literal(false),
        sharpnessAlgorithmId: z.literal('tenengrad-sobel-luma-cell-v1'),
      })
      .strict(),
    regionMetrics: z.array(focusPreviewBlendRegionMetricSchema).min(3),
    warningCodes: z.array(z.string().min(1)),
    width: positiveIntegerSchema.max(512),
  })
  .strict();

export const focusPreviewBlendReportSchema = z
  .object({
    $schema: z.url(),
    algorithm: z
      .object({
        id: z.literal('weighted-sharpness-preview-blend-v2'),
        lowConfidenceWeightFloor: z.literal(0.12),
        maxHaloRiskCellRatio: z.literal(0.2),
        maxRegionMeanAbsoluteError: z.literal(0.08),
        weightPower: z.literal(5),
      })
      .strict(),
    doesNotProve: z.array(
      z.enum([
        'depth_map',
        'final_focus_stack_quality',
        'focus_breathing_compensation',
        'gpu_work',
        'laplacian_pyramid_quality',
        'real_raw_quality',
        'ui_e2e',
      ]),
    ),
    fixtures: z.array(focusPreviewBlendFixtureReportSchema).min(1),
    issue: z.literal(1062),
    runtimeStatus: z.literal('preview_only_synthetic_smoke'),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

export type FocusPreviewBlendReport = z.infer<typeof focusPreviewBlendReportSchema>;

export const parseFocusPreviewBlendReport = (value: unknown): FocusPreviewBlendReport =>
  focusPreviewBlendReportSchema.parse(value);
