#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { localContrastFixtureSchema, localContrastSettingsSchema } from '../../../src/schemas/localContrastSchemas.ts';
import { ADJUSTMENT_GROUPS, DetailsAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const manifest = localContrastFixtureSchema.parse(
  await readJson('fixtures/detail/local-contrast/local-contrast-controls.json'),
);
const invalidCases = await readJson('fixtures/detail/invalid/local-contrast/invalid-local-contrast-controls.json');
const failures = [];

for (const mode of ['classic', 'edge_protected', 'midtone_masked']) {
  if (!manifest.cases.some((testCase) => testCase.mode === mode)) {
    failures.push(`Missing local contrast mode: ${mode}.`);
  }
}

for (const invalidCase of invalidCases) {
  const result = localContrastSettingsSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected invalid local contrast controls.`);
  }
}

if (INITIAL_ADJUSTMENTS.localContrastRadiusPx !== 24) {
  failures.push('Local contrast radius default must stay at 24 px.');
}

const detailGroupKeys = new Set(ADJUSTMENT_GROUPS.details.flatMap((group) => group.keys));
for (const key of [
  DetailsAdjustment.LocalContrastRadiusPx,
  DetailsAdjustment.LocalContrastHaloGuard,
  DetailsAdjustment.LocalContrastMidtoneMask,
]) {
  if (!detailGroupKeys.has(key)) {
    failures.push(`${key} must be included in detail copy/paste groups.`);
  }
}

if (failures.length > 0) {
  console.error('Local contrast control validation failed.');
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} local contrast cases and ${invalidCases.length} invalid cases.`);
