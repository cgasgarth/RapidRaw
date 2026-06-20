#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

const FIXTURE_PATH = 'fixtures/panorama/panorama-feature-transform-fixtures.json';
const REPORT_PATH = 'docs/validation/panorama-feature-transform-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const MINIMUM_INLIERS = 4;
const INLIER_TOLERANCE_PX = 0.001;
const ALGORITHM_ID = 'synthetic_descriptor_translation_ransac_v1';
const RUNTIME_STATUS = 'feature_match_transform_estimate_proof';

const pointSchema = z.tuple([z.number(), z.number()]);
const featureSchema = z
  .object({
    descriptor: z.string().min(1),
    left: pointSchema,
    right: pointSchema,
  })
  .strict();
const successExpectationSchema = z
  .object({
    inlierCount: z.number().int().positive(),
    matchCount: z.number().int().positive(),
    translationX: z.number(),
    translationY: z.number(),
  })
  .strict();
const fixtureCaseSchema = z
  .object({
    case: z.string().min(1),
    expected: successExpectationSchema.optional(),
    expectedFailure: z.literal('insufficient_inlier_matches').optional(),
    expectedMinimumInliers: z.number().int().positive().optional(),
    features: z.array(featureSchema).min(1),
    imageSize: z.object({ height: z.number().int().positive(), width: z.number().int().positive() }).strict(),
    outliers: z.array(featureSchema),
  })
  .strict()
  .superRefine((fixture, context) => {
    if ((fixture.expected === undefined) === (fixture.expectedFailure === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'fixture case must define exactly one success or failure expectation',
        path: ['expected'],
      });
    }
  });
const fixtureSchema = z
  .object({
    $schema: z.url(),
    cases: z.array(fixtureCaseSchema).min(1),
    issue: z.literal(1886),
    schemaVersion: z.literal(1),
    validationMode: z.literal('synthetic_feature_transform_runtime_proof'),
  })
  .strict();
const reportCaseSchema = z.union([
  z
    .object({
      case: z.string().min(1),
      estimatedTransform: z.object({ model: z.literal('translation'), x: z.number(), y: z.number() }).strict(),
      inlierCount: z.number().int().positive(),
      maxInlierErrorPx: z.number().min(0),
      matchCount: z.number().int().positive(),
      provenance: z
        .object({
          algorithmId: z.literal(ALGORITHM_ID),
          boundedFailureMode: z.literal('not_applicable'),
          fixture: z.literal(FIXTURE_PATH),
          runtimeStatus: z.literal(RUNTIME_STATUS),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      case: z.string().min(1),
      failureCode: z.literal('insufficient_inlier_matches'),
      matchCount: z.number().int().nonnegative(),
      minimumInliers: z.number().int().positive(),
      provenance: z
        .object({
          algorithmId: z.literal(ALGORITHM_ID),
          boundedFailureMode: z.literal('actionable_error'),
          fixture: z.literal(FIXTURE_PATH),
          runtimeStatus: z.literal(RUNTIME_STATUS),
        })
        .strict(),
    })
    .strict(),
]);
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    issue: z.literal(1886),
    schemaVersion: z.literal(1),
    validationMode: z.literal('panorama_feature_matching_transform_metadata'),
  })
  .strict();

type Feature = z.infer<typeof featureSchema>;
type ReportCase = z.infer<typeof reportCaseSchema>;

const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const failures: string[] = [];
const reportCases: ReportCase[] = [];

for (const fixtureCase of fixture.cases) {
  const matches = matchFeatures([...fixtureCase.features, ...fixtureCase.outliers]);
  const estimate = estimateTranslation(matches);

  if (fixtureCase.expected !== undefined) {
    if (estimate.kind !== 'success') {
      failures.push(`${fixtureCase.case}: expected transform estimate, got ${estimate.failureCode}`);
      continue;
    }
    assertEqual(estimate.translation.x, fixtureCase.expected.translationX, `${fixtureCase.case}: translation x`);
    assertEqual(estimate.translation.y, fixtureCase.expected.translationY, `${fixtureCase.case}: translation y`);
    assertEqual(estimate.inlierCount, fixtureCase.expected.inlierCount, `${fixtureCase.case}: inlier count`);
    assertEqual(matches.length, fixtureCase.expected.matchCount, `${fixtureCase.case}: match count`);
    reportCases.push({
      case: fixtureCase.case,
      estimatedTransform: { model: 'translation', x: estimate.translation.x, y: estimate.translation.y },
      inlierCount: estimate.inlierCount,
      maxInlierErrorPx: roundMetric(estimate.maxInlierErrorPx),
      matchCount: matches.length,
      provenance: {
        algorithmId: ALGORITHM_ID,
        boundedFailureMode: 'not_applicable',
        fixture: FIXTURE_PATH,
        runtimeStatus: RUNTIME_STATUS,
      },
    });
    continue;
  }

  if (estimate.kind !== 'failure' || estimate.failureCode !== fixtureCase.expectedFailure) {
    failures.push(`${fixtureCase.case}: expected ${fixtureCase.expectedFailure}, got ${estimate.kind}`);
    continue;
  }
  reportCases.push({
    case: fixtureCase.case,
    failureCode: estimate.failureCode,
    matchCount: matches.length,
    minimumInliers: fixtureCase.expectedMinimumInliers ?? MINIMUM_INLIERS,
    provenance: {
      algorithmId: ALGORITHM_ID,
      boundedFailureMode: 'actionable_error',
      fixture: FIXTURE_PATH,
      runtimeStatus: RUNTIME_STATUS,
    },
  });
}

const report = reportSchema.parse({
  cases: reportCases,
  issue: 1886,
  schemaVersion: 1,
  validationMode: 'panorama_feature_matching_transform_metadata',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-panorama-feature-transform.ts --update`,
    );
  }
}

if (failures.length > 0) {
  console.error(`panorama feature transform failed (${failures.length})`);
  for (const failure of failures.slice(0, 10)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`panorama feature transform ok (${report.cases.length} cases)`);

function matchFeatures(features: Feature[]): Feature[] {
  const descriptorCounts = new Map<string, number>();
  for (const feature of features)
    descriptorCounts.set(feature.descriptor, (descriptorCounts.get(feature.descriptor) ?? 0) + 1);
  return features.filter((feature) => descriptorCounts.get(feature.descriptor) === 1);
}

function estimateTranslation(matches: Feature[]):
  | {
      inlierCount: number;
      kind: 'success';
      maxInlierErrorPx: number;
      translation: { x: number; y: number };
    }
  | { failureCode: 'insufficient_inlier_matches'; kind: 'failure' } {
  let best: { inliers: Feature[]; translation: { x: number; y: number } } | null = null;

  for (const match of matches) {
    const translation = { x: match.right[0] - match.left[0], y: match.right[1] - match.left[1] };
    const inliers = matches.filter((candidate) => translationError(candidate, translation) <= INLIER_TOLERANCE_PX);
    if (best === null || inliers.length > best.inliers.length) best = { inliers, translation };
  }

  if (best === null || best.inliers.length < MINIMUM_INLIERS) {
    return { failureCode: 'insufficient_inlier_matches', kind: 'failure' };
  }

  const translation = {
    x: roundMetric(average(best.inliers.map((match) => match.right[0] - match.left[0]))),
    y: roundMetric(average(best.inliers.map((match) => match.right[1] - match.left[1]))),
  };
  return {
    inlierCount: best.inliers.length,
    kind: 'success',
    maxInlierErrorPx: Math.max(...best.inliers.map((match) => translationError(match, translation))),
    translation,
  };
}

function translationError(match: Feature, translation: { x: number; y: number }): number {
  const dx = match.left[0] + translation.x - match.right[0];
  const dy = match.left[1] + translation.y - match.right[1];
  return Math.hypot(dx, dy);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertEqual(actual: number, expected: number, label: string) {
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
