#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  cameraProfileEntrySchema,
  cameraProfileFallbackSchema,
  cameraProfileLookupCatalogSchema,
  cameraProfileMetadataSchema,
  cameraProfileWarningSchema,
  lookupCameraProfile,
} from '../../../src/utils/cameraProfileLookup.ts';
import {
  applyCameraProfileInputTransform,
  cameraProfileMatrix3x3Schema,
  cameraProfileRgbPixelSchema,
  type CameraProfileRgbPixel,
} from '../../../src/utils/cameraProfileInputTransformRuntime.ts';

const FIXTURE_PATH = 'fixtures/color/camera-profile-input-transform-proof.json';
const LOOKUP_FIXTURE_PATH = 'fixtures/color/camera-profile-lookup-fixtures.json';
const REPORT_PATH = 'docs/validation/camera-profile-input-transform-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');

const transformCaseSchema = z
  .object({
    cameraToWorkingMatrix: cameraProfileMatrix3x3Schema,
    expectedInputTransform: z.enum([
      'dng_color_matrix',
      'embedded_dng_color_matrix',
      'libraw_camera_matrix',
      'raw_decoder_neutral_matrix',
    ]),
    expectedProfileId: z.string().min(1),
    expectedWarning: cameraProfileWarningSchema.nullable().optional(),
    expectedWorkingRgb: cameraProfileRgbPixelSchema,
    id: z.string().regex(/^camera-profile\.input-transform\.[a-z0-9.-]+\.v[0-9]+$/u),
    inputCameraRgb: cameraProfileRgbPixelSchema,
    metadata: cameraProfileMetadataSchema,
    runtimeStage: z.literal('camera_profile_to_working_space'),
    tolerance: z.number().positive().max(0.001),
  })
  .strict();
const transformManifestSchema = z
  .object({
    $schema: z.url(),
    cases: z.array(transformCaseSchema).min(1),
    issue: z.literal(1261),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();
const lookupFixtureSchema = z
  .object({
    fallbacks: z.array(cameraProfileFallbackSchema).min(1),
    profiles: z.array(cameraProfileEntrySchema).min(1),
    schemaVersion: z.literal(1),
  })
  .passthrough();
const reportSchema = z
  .object({
    cases: z
      .array(
        z
          .object({
            id: z.string(),
            inputTransform: z.string(),
            maxRgbDelta: z.number().min(0),
            outputWorkingRgb: cameraProfileRgbPixelSchema,
            profileId: z.string(),
            runtimeStage: z.literal('camera_profile_to_working_space'),
            warning: cameraProfileWarningSchema.nullable(),
          })
          .strict(),
      )
      .min(1),
    fixturePath: z.literal(FIXTURE_PATH),
    generatedFromSnapshotDate: z.string(),
    issue: z.literal(1261),
    lookupFixturePath: z.literal(LOOKUP_FIXTURE_PATH),
    schemaVersion: z.literal(1),
    validationMode: z.literal('headless_camera_profile_matrix_transform'),
  })
  .strict();

const manifest = transformManifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const lookupFixture = lookupFixtureSchema.parse(JSON.parse(await readFile(LOOKUP_FIXTURE_PATH, 'utf8')));
const catalog = cameraProfileLookupCatalogSchema.parse({
  fallbacks: lookupFixture.fallbacks,
  profiles: lookupFixture.profiles,
  schemaVersion: lookupFixture.schemaVersion,
});
const failures: Array<string> = [];
const reportCases = [];

for (const testCase of manifest.cases) {
  const lookup = lookupCameraProfile(catalog, testCase.metadata);
  const outputWorkingRgb = applyCameraProfileInputTransform(testCase.inputCameraRgb, testCase.cameraToWorkingMatrix);
  const maxRgbDelta = maxRgbDiff(outputWorkingRgb, testCase.expectedWorkingRgb);
  const expectedWarning = testCase.expectedWarning ?? null;

  if (lookup.id !== testCase.expectedProfileId) {
    failures.push(`${testCase.id}: expected profile ${testCase.expectedProfileId}, got ${lookup.id}`);
  }
  if (lookup.inputTransform !== testCase.expectedInputTransform) {
    failures.push(
      `${testCase.id}: expected transform ${testCase.expectedInputTransform}, got ${lookup.inputTransform}`,
    );
  }
  if (lookup.warning !== expectedWarning) {
    failures.push(`${testCase.id}: expected warning ${expectedWarning ?? 'none'}, got ${lookup.warning ?? 'none'}`);
  }
  if (maxRgbDelta > testCase.tolerance) {
    failures.push(`${testCase.id}: max RGB delta ${maxRgbDelta} exceeds ${testCase.tolerance}`);
  }

  reportCases.push({
    id: testCase.id,
    inputTransform: lookup.inputTransform,
    maxRgbDelta: roundMetric(maxRgbDelta),
    outputWorkingRgb,
    profileId: lookup.id,
    runtimeStage: testCase.runtimeStage,
    warning: lookup.warning,
  });
}

const report = reportSchema.parse({
  cases: reportCases,
  fixturePath: FIXTURE_PATH,
  generatedFromSnapshotDate: manifest.snapshotDate,
  issue: 1261,
  lookupFixturePath: LOOKUP_FIXTURE_PATH,
  schemaVersion: 1,
  validationMode: 'headless_camera_profile_matrix_transform',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-camera-profile-input-transform-proof.ts --update`,
    );
  }
}

if (failures.length > 0) {
  console.error('Camera profile input transform proof failed:');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(`camera profile input transform proof ok (${manifest.cases.length} cases)`);

function maxRgbDiff(actual: CameraProfileRgbPixel, expected: CameraProfileRgbPixel): number {
  return Math.max(
    Math.abs(actual.red - expected.red),
    Math.abs(actual.green - expected.green),
    Math.abs(actual.blue - expected.blue),
  );
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
