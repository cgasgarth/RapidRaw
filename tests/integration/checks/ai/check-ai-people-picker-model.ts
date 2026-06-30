#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskPickerModelFixtureSchema } from '../../../../src/schemas/masks/aiMaskingSchemas.ts';
import { buildAiPeopleMaskPickerModel } from '../../../../src/utils/ai/aiPeopleMaskPickerModel.ts';

const fixtureJson: unknown = JSON.parse(readFileSync(resolve('fixtures/masks/ai/ai-people-picker-model.json'), 'utf8'));
const fixture = aiPeopleMaskPickerModelFixtureSchema.parse(fixtureJson);
const aiPanelSource = readFileSync(resolve('src/components/panel/right/ai/AIPanel.tsx'), 'utf8');
const pickerSource = readFileSync(resolve('src/components/panel/right/ai/AiPeoplePartPickerStatus.tsx'), 'utf8');
const maskPanelSource = readFileSync(resolve('src/components/panel/right/layers/MasksPanel.tsx'), 'utf8');
const hookSource = readFileSync(resolve('src/hooks/ai/useAiMasking.ts'), 'utf8');
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
for (const expectedSelectablePart of ['background', 'clothing', 'face', 'full_person', 'hair']) {
  if (!selectableParts.has(expectedSelectablePart)) {
    console.error(`${expectedSelectablePart}: expected selectable runtime people-mask part`);
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
  "t('editor.masks.aiPeopleParts.title')",
  "t('editor.masks.aiPeopleParts.description')",
]) {
  if (!pickerSource.includes(marker)) {
    console.error(`AI people picker component missing marker: ${marker}`);
    process.exit(1);
  }
}

for (const [surface, source] of [
  ['AI panel', aiPanelSource],
  ['Masks panel', maskPanelSource],
] as const) {
  if (!source.includes('<AiPeoplePartPickerStatus />')) {
    console.error(`${surface}: expected shared AI people picker status component`);
    process.exit(1);
  }
}

if (!aiPanelSource.includes('activeSubMask?.type === Mask.AiPerson')) {
  console.error('AI panel: expected AI people picker to render for active person masks');
  process.exit(1);
}

if (!maskPanelSource.includes('activeSubMask.type === Mask.AiPerson')) {
  console.error('Masks panel: expected AI people picker to render for active person masks');
  process.exit(1);
}

for (const marker of [
  'getAiPeopleMaskPartCapability(part)',
  "part === 'face' || part === 'full_person'",
  "part === 'face' || part === 'full_person' || part === 'clothing' || part === 'hair'",
  "capability.validationMode !== 'runtime_apply'",
]) {
  if (!hookSource.includes(marker)) {
    console.error(`AI people runtime guard missing marker: ${marker}`);
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
