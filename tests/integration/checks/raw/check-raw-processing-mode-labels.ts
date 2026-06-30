#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const settingsSource = readFileSync('src/components/panel/SettingsPanel.tsx', 'utf8');
const controlsSource = readFileSync('src/components/panel/right/color/ControlsPanel.tsx', 'utf8');
const translations = readFileSync('src/i18n/locales/en.json', 'utf8');

const failures: string[] = [];

for (const [sourceName, source] of [
  ['SettingsPanel', settingsSource],
  ['ControlsPanel', controlsSource],
] as const) {
  for (const marker of [
    'getRawProcessingModeDisplayCopy',
    'getRawProcessingModeProvenance',
    'currentValue',
    'showRecipeId',
  ]) {
    if (!source.includes(marker)) failures.push(`${sourceName} missing ${marker}`);
  }

  if (source.includes('default_quality_capture_preprocessing_v1')) {
    failures.push(`${sourceName} still renders the default-quality provenance id directly`);
  }
}

for (const marker of [
  '"currentValue": "Current quality: {{mode}}"',
  '"showRecipeId": "Show recipe ID"',
  '"hideRecipeId": "Hide recipe ID"',
]) {
  if (!translations.includes(marker)) failures.push(`en.json missing ${marker}`);
}

if (failures.length > 0) {
  console.error('raw processing mode label validation failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('raw processing mode labels ok');
