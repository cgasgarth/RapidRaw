#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const colorStylesLocale = locale.editor?.presets?.colorStyles;
const requiredLocaleKeys = [
  'adjustmentCoverage_one',
  'adjustmentCoverage_other',
  'defaultBadge',
  'genericLegalNote',
  'genericSafeBadge',
  'legalNote',
  'userBadge',
];
const missingKeys = requiredLocaleKeys.filter((key) => typeof colorStylesLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing color style UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/panel/right/PresetsPanel.tsx', 'utf8');
for (const marker of [
  'getColorStyleAdjustmentCount',
  'editor.presets.colorStyles.adjustmentCoverage',
  'data-testid={`color-style-adjustment-count-${preset.id}`}',
  'color-style-default-preset-badge',
  'color-style-generic-safe-badge-${preset.id}',
  'color-style-generic-safe-note-${preset.id}',
  'user-color-style-provenance-${preset.id}',
  'user-color-style-legal-note-${preset.id}',
  '!hasBuiltInColorStyles',
]) {
  if (!source.includes(marker)) {
    console.error(`Color style UI coverage marker missing: ${marker}`);
    process.exit(1);
  }
}

console.log('color style UI coverage ok');
