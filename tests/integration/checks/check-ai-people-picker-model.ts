#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskPickerModelFixtureSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import { buildAiPeopleMaskPickerModel } from '../../../src/utils/aiPeopleMaskPickerModel.ts';

const fixtureJson: unknown = JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-picker-model.json'), 'utf8'));
const fixture = aiPeopleMaskPickerModelFixtureSchema.parse(fixtureJson);
const maskPanelSource = readFileSync(resolve('src/components/panel/right/MasksPanel.tsx'), 'utf8');
const locale = JSON.parse(readFileSync(resolve('src/i18n/locales/en.json'), 'utf8')) as {
  editor?: { masks?: { aiPeopleParts?: Record<string, unknown> } };
};

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

for (const marker of [
  'buildAiPeopleMaskPickerModel',
  'data-testid="ai-people-part-picker"',
  'data-testid="ai-people-part-group"',
  'data-testid={`ai-people-part-option-${option.part}`}',
  "data-disabled-reason={option.disabledReason ?? ''}",
  'data-validation-mode={option.validationMode}',
  'activeSubMask.type === Mask.AiPerson',
  "t('editor.masks.aiPeopleParts.title')",
  "t('editor.masks.aiPeopleParts.description')",
]) {
  if (!maskPanelSource.includes(marker)) {
    console.error(`AI people picker UI missing marker: ${marker}`);
    process.exit(1);
  }
}

for (const key of ['description', 'title']) {
  if (typeof locale.editor?.masks?.aiPeopleParts?.[key] !== 'string') {
    console.error(`Missing AI people picker locale: editor.masks.aiPeopleParts.${key}`);
    process.exit(1);
  }
}

console.log(`ai people picker ok (${actualModel.groups.length} groups, ${optionCount} options)`);
