#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { rawEngineGamutMappingFixtureManifestV1Schema } from '../packages/rawengine-schema/src/rawEngineSchemas.ts';

const FIXTURE_PATH = 'fixtures/color/gamut-mapping-fixtures.json';

const REQUIRED_CASE_IDS = new Set([
  'gamut.srgb.neutral-in-gamut.v1',
  'gamut.srgb.p3-primary-out-of-gamut.v1',
  'gamut.display-p3.p3-primary-in-gamut.v1',
  'gamut.srgb.negative-component-warning.v1',
  'gamut.srgb.hdr-component-warning.v1',
  'gamut.srgb.perceptual-intent-blocked.v1',
  'gamut.scene-referred.no-output-map.v1',
]);

const classify = (rgb) => {
  const minComponent = Math.min(...rgb);
  const maxComponent = Math.max(...rgb);
  const hasNegative = minComponent < 0;
  const hasHigh = maxComponent > 1;

  if (hasNegative && hasHigh) return 'mixed_out_of_gamut';
  if (hasNegative) return 'negative_component';
  if (hasHigh) return 'high_component';
  return 'in_gamut';
};

const countOutOfGamutChannels = (rgb) => rgb.filter((component) => component < 0 || component > 1).length;

const hasWarning = (testCase, warning) => testCase.policy.warnings.includes(warning);

const fixturePath = resolve(FIXTURE_PATH);
const fixtureText = await readFile(fixturePath, 'utf8');
const manifest = rawEngineGamutMappingFixtureManifestV1Schema.parse(JSON.parse(fixtureText));
const failures = [];

const actualIds = new Set(manifest.cases.map((testCase) => testCase.id));
for (const requiredId of REQUIRED_CASE_IDS) {
  if (!actualIds.has(requiredId)) failures.push(`Missing required fixture: ${requiredId}`);
}

for (const testCase of manifest.cases) {
  const rgb = testCase.destinationLinearRgbBeforeMap;
  const actualClassification = classify(rgb);
  const minComponent = Math.min(...rgb);
  const maxComponent = Math.max(...rgb);
  const maxOvershoot = Math.max(0, maxComponent - 1);
  const maxUndershoot = Math.max(0, -minComponent);
  const outOfGamutChannelCount = countOutOfGamutChannels(rgb);

  if (actualClassification !== testCase.expectedClassification) {
    failures.push(`${testCase.id}: expected ${testCase.expectedClassification}, got ${actualClassification}`);
  }

  if (actualClassification === 'in_gamut' && outOfGamutChannelCount !== 0) {
    failures.push(`${testCase.id}: in-gamut classification has ${outOfGamutChannelCount} out-of-gamut channels`);
  }

  if (
    (actualClassification === 'high_component' || actualClassification === 'mixed_out_of_gamut') &&
    maxOvershoot <= 0
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
    maxUndershoot <= 0
  ) {
    failures.push(`${testCase.id}: negative-component case has no negative undershoot`);
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

  if (testCase.policy.destination === 'scene_referred' && testCase.policy.method !== 'none_scene_referred_v1') {
    failures.push(`${testCase.id}: scene-referred policy must not apply an output map`);
  }
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

if (failures.length > 0) {
  console.error('Gamut mapping fixture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} gamut mapping fixture cases.`);
