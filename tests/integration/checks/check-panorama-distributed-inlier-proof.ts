#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { estimatePanoramaLoRansacTranslationV1 } from '../../../packages/rawengine-schema/src/panorama/panoramaLocalOptimizationRansac.ts';

const REPORT_PATH = 'docs/validation/proofs/panorama/panorama-distributed-inlier-proof-2026-06-20.json';
const UPDATE_REPORT = process.argv.includes('--update');
const baseRequest = {
  imageSize: { height: 100, width: 100 },
  inlierTolerancePx: 0.25,
  minimumInliers: 4,
  spatialSupport: {
    gridColumns: 2,
    gridRows: 2,
    minimumOccupiedCells: 3,
  },
};

const spatialSupportSchema = z
  .object({
    gridColumns: z.literal(2),
    gridRows: z.literal(2),
    minimumOccupiedCells: z.literal(3),
    occupiedCellCount: z.number().int().nonnegative(),
    occupiedCellRatio: z.number().min(0).max(1),
    occupiedCells: z.array(z.string().min(1)),
    status: z.enum(['accepted', 'rejected']),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z
      .array(
        z.union([
          z
            .object({
              case: z.literal('distributed-inliers-accepted'),
              inlierCount: z.literal(5),
              refinedModel: z.object({ model: z.literal('translation'), x: z.literal(12), y: z.literal(3) }).strict(),
              spatialSupport: spatialSupportSchema.extend({
                occupiedCellCount: z.literal(4),
                status: z.literal('accepted'),
              }),
            })
            .strict(),
          z
            .object({
              case: z.literal('concentrated-inliers-rejected'),
              failureCode: z.literal('insufficient_spatial_support'),
              matchCount: z.literal(5),
              spatialSupport: spatialSupportSchema.extend({
                occupiedCellCount: z.literal(1),
                status: z.literal('rejected'),
              }),
            })
            .strict(),
        ]),
      )
      .length(2),
    issue: z.literal(2289),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_distributed_inlier_support'),
    validationStatus: z.literal('synthetic_runtime_metadata_gate'),
  })
  .strict();

const distributed = estimatePanoramaLoRansacTranslationV1({
  ...baseRequest,
  matches: [
    { descriptor: 'd0', left: [10, 10], right: [22, 13] },
    { descriptor: 'd1', left: [80, 12], right: [92, 15] },
    { descriptor: 'd2', left: [12, 82], right: [24, 85] },
    { descriptor: 'd3', left: [82, 84], right: [94, 87] },
    { descriptor: 'd4', left: [50, 50], right: [62, 53] },
  ],
});
const concentrated = estimatePanoramaLoRansacTranslationV1({
  ...baseRequest,
  matches: [
    { descriptor: 'c0', left: [8, 8], right: [20, 11] },
    { descriptor: 'c1', left: [12, 10], right: [24, 13] },
    { descriptor: 'c2', left: [16, 12], right: [28, 15] },
    { descriptor: 'c3', left: [18, 16], right: [30, 19] },
    { descriptor: 'c4', left: [20, 20], right: [32, 23] },
  ],
});

if (distributed.kind !== 'success') throw new Error('distributed inlier proof expected success.');
if (concentrated.kind !== 'failure') throw new Error('concentrated inlier proof expected failure.');

const report = reportSchema.parse({
  cases: [
    {
      case: 'distributed-inliers-accepted',
      inlierCount: distributed.inlierCount,
      refinedModel: distributed.localOptimization.refinedModel,
      spatialSupport: distributed.spatialSupport,
    },
    {
      case: 'concentrated-inliers-rejected',
      failureCode: concentrated.failureCode,
      matchCount: concentrated.matchCount,
      spatialSupport: concentrated.spatialSupport,
    },
  ],
  issue: 2289,
  schemaVersion: 1,
  validationMode: 'panorama_distributed_inlier_support',
  validationStatus: 'synthetic_runtime_metadata_gate',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    throw new Error(`${REPORT_PATH} is stale; run bun run check:panorama-distributed-inlier-proof:update.`);
  }
}

console.log(`panorama distributed inlier proof ok (${report.cases.length} cases)`);
