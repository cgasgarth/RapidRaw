#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { rawEngineGamutMappingFixtureManifestV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import {
  applyRelativeColorimetricClipFallback,
  classifyLinearRgbGamut,
  type GamutClassification,
} from '../../../src/utils/gamutMappingRuntime.ts';

const FIXTURE_PATH = 'fixtures/color/gamut-mapping-fixtures.json';
const REPORT_PATH = 'docs/validation/color-gamut-clipping-gate-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const COMPONENT_BOUNDARY_EPSILON = 1e-12;
const MIN_OUT_OF_GAMUT_MAGNITUDE = 1e-6;

const REQUIRED_CASE_IDS = new Set([
  'gamut.srgb.neutral-in-gamut.v1',
  'gamut.srgb.p3-primary-out-of-gamut.v1',
  'gamut.display-p3.p3-primary-in-gamut.v1',
  'gamut.srgb.negative-component-warning.v1',
  'gamut.srgb.hdr-component-warning.v1',
  'gamut.srgb.perceptual-intent-blocked.v1',
  'gamut.scene-referred.no-output-map.v1',
]);

const hasWarning = (testCase: { policy: { warnings: ReadonlyArray<string> } }, warning: string) =>
  testCase.policy.warnings.includes(warning);
interface GamutClipReportCase {
  clipDeltaL1: number;
  clipDeltaMax: number;
  clippedLinearRgb: Array<number>;
  id: string;
  inputMax: number;
  inputMin: number;
  outOfGamutChannelCount: number;
  outOfGamutMagnitude: number;
  runtimeClassification: GamutClassification;
  warnings: Array<string>;
}

const fixturePath = resolve(FIXTURE_PATH);
const fixtureText = await readFile(fixturePath, 'utf8');
const manifest = rawEngineGamutMappingFixtureManifestV1Schema.parse(JSON.parse(fixtureText));
const failures = [];
const reportCases: Array<GamutClipReportCase> = [];

const actualIds = new Set(manifest.cases.map((testCase) => testCase.id));
for (const requiredId of REQUIRED_CASE_IDS) {
  if (!actualIds.has(requiredId)) failures.push(`Missing required fixture: ${requiredId}`);
}

for (const testCase of manifest.cases) {
  const rgb = testCase.destinationLinearRgbBeforeMap;
  const runtime = applyRelativeColorimetricClipFallback(rgb);
  const actualClassification = classifyLinearRgbGamut(rgb);
  const minComponent = Math.min(...rgb);
  const maxComponent = Math.max(...rgb);
  const maxOvershoot = Math.max(0, maxComponent - 1);
  const maxUndershoot = Math.max(0, -minComponent);
  const outOfGamutChannelCount = runtime.outOfGamutChannelCount;
  const clipDeltas = rgb.map((component, index) => Math.abs(component - runtime.clippedLinearRgb[index]));
  const clipDeltaL1 = clipDeltas.reduce((sum, delta) => sum + delta, 0);
  const clipDeltaMax = Math.max(...clipDeltas);
  const outOfGamutMagnitude = Math.max(maxOvershoot, maxUndershoot);

  if (actualClassification !== testCase.expectedClassification) {
    failures.push(`${testCase.id}: expected ${testCase.expectedClassification}, got ${actualClassification}`);
  }

  if (runtime.classification !== testCase.expectedClassification) {
    failures.push(`${testCase.id}: runtime expected ${testCase.expectedClassification}, got ${runtime.classification}`);
  }

  if (runtime.clippedLinearRgb.some((component) => component < 0 || component > 1)) {
    failures.push(`${testCase.id}: clipped runtime RGB left output cube.`);
  }

  if (actualClassification === 'in_gamut' && outOfGamutChannelCount !== 0) {
    failures.push(`${testCase.id}: in-gamut classification has ${outOfGamutChannelCount} out-of-gamut channels`);
  }

  if (
    (actualClassification === 'high_component' || actualClassification === 'mixed_out_of_gamut') &&
    maxOvershoot <= MIN_OUT_OF_GAMUT_MAGNITUDE
  ) {
    failures.push(`${testCase.id}: high-component case has no positive overshoot`);
  }

  if (
    (actualClassification === 'high_component' || actualClassification === 'mixed_out_of_gamut') &&
    !hasWarning(testCase, 'output_gamut_high_component_v1')
  ) {
    failures.push(`${testCase.id}: high-component case must include output_gamut_high_component_v1`);
  }

  if (
    (actualClassification === 'negative_component' || actualClassification === 'mixed_out_of_gamut') &&
    maxUndershoot <= MIN_OUT_OF_GAMUT_MAGNITUDE
  ) {
    failures.push(`${testCase.id}: negative-component case has no negative undershoot`);
  }

  if (actualClassification === 'in_gamut' && clipDeltaMax > COMPONENT_BOUNDARY_EPSILON) {
    failures.push(`${testCase.id}: in-gamut clip delta ${clipDeltaMax} exceeds boundary epsilon`);
  }

  if (actualClassification !== 'in_gamut' && clipDeltaMax <= COMPONENT_BOUNDARY_EPSILON) {
    failures.push(`${testCase.id}: out-of-gamut case did not produce a measurable clip delta`);
  }

  if (
    (actualClassification === 'negative_component' || actualClassification === 'mixed_out_of_gamut') &&
    !hasWarning(testCase, 'output_gamut_negative_component_v1')
  ) {
    failures.push(`${testCase.id}: negative-component case must include output_gamut_negative_component_v1`);
  }

  if (testCase.policy.intent === 'perceptual' && !hasWarning(testCase, 'output_gamut_perceptual_intent_unproven_v1')) {
    failures.push(`${testCase.id}: perceptual intent must include output_gamut_perceptual_intent_unproven_v1`);
  }

  if (
    testCase.policy.status === 'schema_only' &&
    !hasWarning(testCase, 'output_gamut_mapping_not_runtime_applied_v1')
  ) {
    failures.push(`${testCase.id}: schema-only case must include output_gamut_mapping_not_runtime_applied_v1`);
  }

  if (testCase.policy.method === 'relative_colorimetric_clip_fallback_v1') {
    for (const warning of runtime.warnings) {
      if (!hasWarning(testCase, warning)) failures.push(`${testCase.id}: missing runtime warning ${warning}`);
    }
  }

  if (testCase.policy.destination === 'scene_referred' && testCase.policy.method !== 'none_scene_referred_v1') {
    failures.push(`${testCase.id}: scene-referred policy must not apply an output map`);
  }

  reportCases.push({
    clipDeltaL1: roundMetric(clipDeltaL1),
    clipDeltaMax: roundMetric(clipDeltaMax),
    clippedLinearRgb: runtime.clippedLinearRgb.map(roundMetric),
    id: testCase.id,
    inputMax: roundMetric(maxComponent),
    inputMin: roundMetric(minComponent),
    outOfGamutChannelCount,
    outOfGamutMagnitude: roundMetric(outOfGamutMagnitude),
    runtimeClassification: runtime.classification,
    warnings: runtime.warnings,
  });
}

const invalidRuntimeOverclaim = rawEngineGamutMappingFixtureManifestV1Schema.safeParse({
  ...manifest,
  cases: [
    {
      ...manifest.cases[0],
      policy: {
        ...manifest.cases[0].policy,
        status: 'preview_applied',
      },
    },
  ],
});
if (invalidRuntimeOverclaim.success) {
  failures.push('Runtime overclaim status must be rejected.');
}

const invalidNonFinite = rawEngineGamutMappingFixtureManifestV1Schema.safeParse({
  ...manifest,
  cases: [
    {
      ...manifest.cases[0],
      destinationLinearRgbBeforeMap: [0.1, Number.POSITIVE_INFINITY, 0.3],
    },
  ],
});
if (invalidNonFinite.success) {
  failures.push('Non-finite RGB fixture values must be rejected.');
}

const report = {
  cases: reportCases,
  fixturePath: FIXTURE_PATH,
  generatedFromSnapshotDate: manifest.snapshotDate,
  issue: 1931,
  schemaVersion: 1,
  thresholds: {
    componentBoundaryEpsilon: COMPONENT_BOUNDARY_EPSILON,
    minOutOfGamutMagnitude: MIN_OUT_OF_GAMUT_MAGNITUDE,
  },
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;

if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-gamut-mapping-fixtures.ts --update`);
  }
}

if (failures.length > 0) {
  console.error('Gamut mapping fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const maxClipDelta = Math.max(...reportCases.map((testCase) => testCase.clipDeltaMax));
console.log(`gamut clipping gate ok (${manifest.cases.length} cases, max clip ${roundMetric(maxClipDelta)})`);

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
