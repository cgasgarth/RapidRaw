#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

const [source, locale, packageJson] = await Promise.all([
  readFile('src/components/panel/right/PresetsPanel.tsx', 'utf8'),
  readFile('src/i18n/locales/en.json', 'utf8'),
  readFile('package.json', 'utf8'),
]);

const localeJson = JSON.parse(locale) as {
  editor?: { presets?: { composition?: Record<string, string> } };
};

const requiredSourceSnippets = [
  'presetCompositionItems',
  'userPresetCount',
  'generatedPreviewCount',
  'data-testid="presets-composition-summary"',
  'data-presets-composition-item={item}',
];
const requiredKeys = [
  'colorStyles_one',
  'colorStyles_other',
  'userPresets_one',
  'userPresets_other',
  'folders_one',
  'folders_other',
  'previewsGenerating',
  'previewsReady_one',
  'previewsReady_other',
];
const composition = localeJson.editor?.presets?.composition ?? {};
const failures = [
  ...requiredSourceSnippets.filter((snippet) => !source.includes(snippet)).map((snippet) => `missing: ${snippet}`),
  ...requiredKeys.filter((key) => composition[key] === undefined).map((key) => `missing locale: ${key}`),
];

if (!packageJson.includes('"check:presets-composition-ui"')) {
  failures.push('missing package script: check:presets-composition-ui');
}
if (failures.length > 0) {
  console.error('presets composition UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('presets composition UI ok');
