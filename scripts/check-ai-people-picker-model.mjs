#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskPickerModelFixtureSchema } from '../src/schemas/aiMaskingSchemas.ts';
import { buildAiPeopleMaskPickerModel } from '../src/utils/aiPeopleMaskPickerModel.ts';

const fixture = aiPeopleMaskPickerModelFixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-picker-model.json'), 'utf8')),
);

const actualModel = buildAiPeopleMaskPickerModel();

if (JSON.stringify(actualModel) !== JSON.stringify(fixture.expectedModel)) {
  console.error('AI people-mask picker model mismatch.');
  console.error(JSON.stringify({ actualModel, expectedModel: fixture.expectedModel }, null, 2));
  process.exit(1);
}

const optionCount = actualModel.groups.reduce((total, group) => total + group.options.length, 0);
console.log(`Validated ${actualModel.groups.length} people-mask picker groups and ${optionCount} options.`);
