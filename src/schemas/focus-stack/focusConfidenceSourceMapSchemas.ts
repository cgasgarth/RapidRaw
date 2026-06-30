import { z } from 'zod';

const nonnegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();
const ratioSchema = z.number().min(0).max(1);

export const focusConfidenceSourceSummarySchema = z
  .object({
    sourceIndex: nonnegativeIntegerSchema,
    winnerCellRatio: ratioSchema,
  })
  .strict();

export const focusConfidenceSourceMapFixtureSchema = z
  .object({
    fixtureId: z.string().regex(/^focus\.synthetic\.[a-z0-9.-]+\.v[0-9]+$/u),
    grid: z
      .object({
        cellCount: positiveIntegerSchema,
        cellSize: z.literal(8),
        lowConfidenceCellRatio: ratioSchema,
      })
      .strict(),
    referenceSourceIndex: nonnegativeIntegerSchema,
    sourceSummaries: z.array(focusConfidenceSourceSummarySchema).min(2),
    warningCodes: z.array(z.string().trim().min(1)),
  })
  .strict();

export const focusConfidenceSourceMapReportSchema = z
  .object({
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
    fixtures: z.array(focusConfidenceSourceMapFixtureSchema).min(1),
    generatedFrom: z.literal('tests/integration/checks/focus/check-focus-confidence-source-map.ts'),
    issue: z.literal(2354),
    schemaVersion: z.literal(1),
    sourceSharpnessArtifact: z.literal('artifacts/focus-sharpness-map/focus-sharpness-map-report.json'),
    status: z.literal('synthetic_source_confidence_artifact_generated'),
  })
  .strict();

export type FocusConfidenceSourceMapReport = z.infer<typeof focusConfidenceSourceMapReportSchema>;

export const parseFocusConfidenceSourceMapReport = (value: unknown): FocusConfidenceSourceMapReport =>
  focusConfidenceSourceMapReportSchema.parse(value);
