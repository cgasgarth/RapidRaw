#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const ALIGNMENT_REPORT_PATH = 'docs/validation/proofs/panorama/panorama-feature-transform-proof-2026-06-18.json';
const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-projection-crop-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const ALGORITHM_ID = 'synthetic_projection_crop_v1';
const RUNTIME_STATUS = 'projection_crop_metadata_proof';
const SOURCE_SIZE = { height: 48, width: 72 };

const rectangleSchema = z
  .object({ height: z.number().int(), width: z.number().int(), x: z.number().int(), y: z.number().int() })
  .strict();
const alignmentCaseSchema = z
  .object({
    case: z.literal('horizontal-overlap-translation'),
    estimatedTransform: z.object({ model: z.literal('translation'), x: z.number(), y: z.number() }).strict(),
    inlierCount: z.number().int().positive(),
    maxInlierErrorPx: z.number().min(0),
    matchCount: z.number().int().positive(),
    provenance: z.object({ runtimeStatus: z.literal('feature_match_transform_estimate_proof') }).passthrough(),
  })
  .strict();
const alignmentReportSchema = z
  .object({
    cases: z.array(z.union([alignmentCaseSchema, z.unknown()])),
    issue: z.literal(1886),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_feature_matching_transform_metadata'),
  })
  .strict();
const reportCaseSchema = z
  .object({
    autoCrop: rectangleSchema.extend({ mode: z.literal('auto') }).strict(),
    case: z.literal('horizontal-overlap-translation'),
    fullCanvas: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    projection: z
      .object({
        effectiveProjection: z.literal('rectilinear'),
        requestedProjection: z.literal('cylindrical'),
        support: z.literal('metadata_serialized_runtime_deferred'),
      })
      .strict(),
    provenance: z
      .object({
        alignmentProof: z.literal(ALIGNMENT_REPORT_PATH),
        algorithmId: z.literal(ALGORITHM_ID),
        previewExportParity: z.literal('deferred_to_1888_blend_export'),
        runtimeStatus: z.literal(RUNTIME_STATUS),
      })
      .strict(),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    issue: z.literal(1887),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_projection_crop_metadata'),
  })
  .strict();

const alignmentReport = alignmentReportSchema.parse(JSON.parse(await readFile(ALIGNMENT_REPORT_PATH, 'utf8')));
const alignmentCase = alignmentReport.cases.find(
  (reportCase): reportCase is z.infer<typeof alignmentCaseSchema> =>
    typeof reportCase === 'object' &&
    reportCase !== null &&
    'case' in reportCase &&
    reportCase.case === 'horizontal-overlap-translation' &&
    'estimatedTransform' in reportCase,
);

if (alignmentCase === undefined) {
  throw new Error('missing horizontal-overlap-translation alignment proof');
}

const fullCanvas = computeCanvas(alignmentCase.estimatedTransform);
const autoCrop = computeOverlapCrop(alignmentCase.estimatedTransform);
const report = reportSchema.parse({
  cases: [
    {
      autoCrop: { ...autoCrop, mode: 'auto' },
      case: alignmentCase.case,
      fullCanvas,
      projection: {
        effectiveProjection: 'rectilinear',
        requestedProjection: 'cylindrical',
        support: 'metadata_serialized_runtime_deferred',
      },
      provenance: {
        alignmentProof: ALIGNMENT_REPORT_PATH,
        algorithmId: ALGORITHM_ID,
        previewExportParity: 'deferred_to_1888_blend_export',
        runtimeStatus: RUNTIME_STATUS,
      },
    },
  ],
  issue: 1887,
  schemaVersion: 1,
  validationMode: 'panorama_projection_crop_metadata',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    console.error(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/panorama/check-panorama-projection-crop.ts --update`,
    );
    process.exit(1);
  }
}

console.log(`panorama projection crop ok (${report.cases.length} cases)`);

function computeCanvas(translation: { x: number; y: number }): { height: number; width: number } {
  const minX = Math.min(0, translation.x);
  const minY = Math.min(0, translation.y);
  const maxX = Math.max(SOURCE_SIZE.width, translation.x + SOURCE_SIZE.width);
  const maxY = Math.max(SOURCE_SIZE.height, translation.y + SOURCE_SIZE.height);
  return { height: maxY - minY, width: maxX - minX };
}

function computeOverlapCrop(translation: { x: number; y: number }): {
  height: number;
  width: number;
  x: number;
  y: number;
} {
  const x = Math.max(0, translation.x);
  const y = Math.max(0, translation.y);
  const right = Math.min(SOURCE_SIZE.width, translation.x + SOURCE_SIZE.width);
  const bottom = Math.min(SOURCE_SIZE.height, translation.y + SOURCE_SIZE.height);
  return { height: bottom - y, width: right - x, x, y };
}
