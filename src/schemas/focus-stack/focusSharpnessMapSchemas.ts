import { z } from 'zod';

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const ratioSchema = z.number().min(0).max(1);
const sharpnessScoreSchema = z.number().nonnegative();

export const focusSharpnessSourceScoreSchema = z
  .object({
    relativeConfidence: ratioSchema,
    sharpnessScore: sharpnessScoreSchema,
    sourceIndex: nonnegativeIntegerSchema,
  })
  .strict();

export const focusSharpnessMapCellSchema = z
  .object({
    confidenceMargin: ratioSchema,
    height: positiveIntegerSchema,
    lowConfidence: z.boolean(),
    sourceScores: z.array(focusSharpnessSourceScoreSchema).length(3),
    width: positiveIntegerSchema,
    winnerSourceIndex: nonnegativeIntegerSchema,
    x: nonnegativeIntegerSchema,
    y: nonnegativeIntegerSchema,
  })
  .strict();

export const focusSharpnessExpectedRegionResultSchema = z
  .object({
    aggregateConfidenceMargin: z.number(),
    cellCount: positiveIntegerSchema,
    expectedSourceIndex: nonnegativeIntegerSchema,
    lowConfidenceCellRatio: ratioSchema,
    meanConfidenceMargin: ratioSchema,
    observedWinnerSourceIndex: nonnegativeIntegerSchema,
    regionId: z.string().regex(/^[a-z0-9-]+$/u),
    status: z.enum(['pass', 'fail']),
    winnerCellRatio: ratioSchema,
  })
  .strict();

export const focusSharpnessAppliedTransformSchema = z
  .object({
    dx: z.number().int(),
    dy: z.number().int(),
    expectedScale: z.number().positive(),
    scaleCompensationApplied: z.literal(false),
    sourceIndex: nonnegativeIntegerSchema,
  })
  .strict();

export const focusSharpnessFixtureReportSchema = z
  .object({
    appliedTransforms: z.array(focusSharpnessAppliedTransformSchema).length(3),
    expectedRegionResults: z.array(focusSharpnessExpectedRegionResultSchema).min(3),
    expectedWarningCodes: z.array(z.string().min(1)),
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    height: positiveIntegerSchema.max(512),
    map: z
      .object({
        cellSize: z.literal(8),
        cells: z.array(focusSharpnessMapCellSchema).min(1),
        gridHeight: positiveIntegerSchema,
        gridWidth: positiveIntegerSchema,
      })
      .strict(),
    referenceSourceIndex: z.literal(0),
    width: positiveIntegerSchema.max(512),
  })
  .strict();

export const focusSharpnessMapReportSchema = z
  .object({
    $schema: z.url(),
    algorithm: z
      .object({
        cellSizePx: z.literal(8),
        confidenceMarginFormula: z.literal('(bestScore-secondBestScore)/max(bestScore,epsilon)'),
        detailKernel: z.literal('sobel-3x3-gradient-energy'),
        epsilon: z.literal(1e-9),
        id: z.literal('tenengrad-sobel-luma-cell-v1'),
        lowConfidenceMarginThreshold: z.literal(0.12),
        lowSharpnessScoreThreshold: z.literal(0.0005),
        luma: z.literal('rec709'),
        maxExpectedRegionLowConfidenceCellRatio: z.literal(0.5),
        regionAggregateMarginThreshold: z.literal(0.16),
        regionWinnerCellRatioThreshold: z.literal(0.8),
        smoothingWindowPx: z.literal(11),
      })
      .strict(),
    doesNotProve: z.array(
      z.enum([
        'depth_map',
        'final_blending',
        'focus_breathing_compensation',
        'real_raw_quality',
        'segmentation',
        'ui_e2e',
      ]),
    ),
    fixtures: z.array(focusSharpnessFixtureReportSchema).min(1),
    issue: z.literal(1061),
    manifestIssue: z.literal(1059),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

export type FocusSharpnessMapReport = z.infer<typeof focusSharpnessMapReportSchema>;

export const parseFocusSharpnessMapReport = (value: unknown): FocusSharpnessMapReport =>
  focusSharpnessMapReportSchema.parse(value);
