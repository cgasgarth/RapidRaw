#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { aiPeopleMaskFakeProviderFixtureSchema } from '../../../src/schemas/aiMaskingSchemas.ts';
import { getAiPeopleMaskPartCapability } from '../../../src/utils/aiPeopleMaskContracts.ts';
import { renderFakeAiPeopleMask } from '../../../src/utils/aiPeopleMaskFakeProvider.ts';
import { createAiPeopleMaskLayerApplyPlan } from '../../../src/utils/aiPeopleMaskLayerPlan.ts';

const fakeProviderFixture = aiPeopleMaskFakeProviderFixtureSchema.parse(
  JSON.parse(readFileSync(resolve('fixtures/masks/ai-people-fake-provider.json'), 'utf8')),
);
const parserSource = readFileSync(resolve('src-tauri/src/person_part_parser.rs'), 'utf8');
const commandSource = readFileSync(resolve('src-tauri/src/ai_commands.rs'), 'utf8');
const hookSource = readFileSync(resolve('src/hooks/ai/useAiMasking.ts'), 'utf8');
const maskPanelSource = readFileSync(resolve('src/components/panel/right/Masks.tsx'), 'utf8');
const maskSettingsSource = readFileSync(resolve('src/components/panel/right/MasksPanel.tsx'), 'utf8');
const locale = JSON.parse(readFileSync(resolve('src/i18n/locales/en.json'), 'utf8')) as {
  editor?: { masks?: { aiPeopleParts?: Record<string, unknown> } };
};

const failures: string[] = [];
const expectedParts = ['hair', 'clothing'] as const;

for (const part of expectedParts) {
  const capability = getAiPeopleMaskPartCapability(part);
  if (capability.status !== 'supported' || capability.validationMode !== 'runtime_apply') {
    failures.push(`${part}: expected supported runtime_apply capability`);
  }
}

const hairMask = renderFakeAiPeopleMask(fakeProviderFixture.analysis, { part: 'hair', personId: 'person-1' }, 8, 8);
const clothingMask = renderFakeAiPeopleMask(
  fakeProviderFixture.analysis,
  { part: 'clothing', personId: 'person-1' },
  8,
  8,
);

if (hairMask.coverage <= 0) failures.push('hair fake-provider output must be non-empty');
if (clothingMask.coverage <= 0) failures.push('clothing fake-provider output must be non-empty');
if (JSON.stringify(hairMask.rows) === JSON.stringify(clothingMask.rows)) {
  failures.push('hair and clothing runtime masks must be distinct outputs');
}

const applyPlan = createAiPeopleMaskLayerApplyPlan(fakeProviderFixture.analysis, [hairMask, clothingMask]);
for (const part of expectedParts) {
  if (!applyPlan.layers.some((layer) => layer.target.part === part && layer.visible)) {
    failures.push(`${part}: expected visible local-adjustment layer plan`);
  }
}

for (const [label, source, marker] of [
  ['parser hair target', parserSource, 'Self::Hair => &[PERSON_PART_HAIR_CLASS]'],
  ['parser hair provenance', parserSource, 'hair_provenance_names_model_and_class'],
  ['command hair route', commandSource, '"clothing" | "hair"'],
  ['hook runtime guard', hookSource, "part === 'clothing' || part === 'hair'"],
  ['mask panel create entry', maskPanelSource, "personPart: 'hair'"],
  ['mask provenance card', maskSettingsSource, 'data-testid="ai-person-mask-provenance"'],
  ['mask provenance model', maskSettingsSource, "data-model-id={modelId ?? ''}"],
  ['mask provenance classes', maskSettingsSource, "data-class-ids={classIds.join(',')}"],
] as const) {
  if (!source.includes(marker)) failures.push(`${label}: missing ${marker}`);
}

for (const key of ['classes', 'model', 'provider', 'provenanceTitle', 'target']) {
  if (typeof locale.editor?.masks?.aiPeopleParts?.[key] !== 'string') {
    failures.push(`Missing AI people provenance locale: editor.masks.aiPeopleParts.${key}`);
  }
}

if (failures.length > 0) {
  console.error(`ai people hair/clothing runtime failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`ai people hair/clothing runtime ok (${applyPlan.layers.length} layers)`);
