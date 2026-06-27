#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskPickerModelFixtureSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import { buildAiPeopleMaskPickerModel } from '../../../src/utils/aiPeopleMaskPickerModel.ts';

const fixtureJson: unknown = JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-picker-model.json'), 'utf8'));
const fixture = aiPeopleMaskPickerModelFixtureSchema.parse(fixtureJson);

const actualModel = buildAiPeopleMaskPickerModel();

if (JSON.stringify(actualModel) !== JSON.stringify(fixture.expectedModel)) {
  console.error('AI people-mask picker model mismatch.');
  console.error(JSON.stringify({ actualModel, expectedModel: fixture.expectedModel }, null, 2));
  process.exit(1);
}

const optionCount = actualModel.groups.reduce((total, group) => total + group.options.length, 0);
const options = actualModel.groups.flatMap((group) => group.options);
const selectableParts = new Set(
  options.filter((option) => option.disabledReason === null).map((option) => option.part),
);
for (const expectedSelectablePart of ['background', 'face', 'full_person']) {
  if (!selectableParts.has(expectedSelectablePart)) {
    console.error(`${expectedSelectablePart}: expected selectable runtime people-mask part`);
    process.exit(1);
  }
}

for (const expectedDisabledPart of ['hair', 'clothing']) {
  const option = options.find((candidate) => candidate.part === expectedDisabledPart);
  if (option?.disabledReason === null || option === undefined) {
    console.error(`${expectedDisabledPart}: expected disabled until a real parser provider lands`);
    process.exit(1);
  }
}

console.log(`ai people picker ok (${actualModel.groups.length} groups, ${optionCount} options)`);
