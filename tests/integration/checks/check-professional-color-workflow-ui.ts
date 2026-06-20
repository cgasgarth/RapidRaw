#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/adjustments/Color.tsx', 'utf8');
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const colorLocale = locale.adjustments?.color;

const requiredLocaleKeys = [
  'channelMixer.title',
  'colorBalanceRgb.title',
  'colorGrading',
  'colorMixer',
  'profileTone.title',
];
const getValue = (root: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((value, segment) => {
    if (value && typeof value === 'object' && segment in value) {
      return (value as Record<string, unknown>)[segment];
    }
    return undefined;
  }, root);

const missingLocaleKeys = requiredLocaleKeys.filter((key) => typeof getValue(colorLocale, key) !== 'string');
if (missingLocaleKeys.length > 0) {
  console.error(`Missing professional color workflow locale keys: ${missingLocaleKeys.join(', ')}`);
  process.exit(1);
}

for (const marker of [
  'ColorWorkflowReadinessRail',
  'data-testid="professional-color-workflow-readiness"',
  'data-testid="professional-color-readiness-item"',
  'data-profile-tone-ready="true"',
  'data-color-balance-ready="true"',
  'data-selective-color-ready="true"',
  'data-channel-mixer-ready="true"',
  'data-grading-ready="true"',
  "t('adjustments.color.profileTone.title')",
  "t('adjustments.color.colorBalanceRgb.title')",
  "t('adjustments.color.channelMixer.title')",
  "t('adjustments.color.colorMixer')",
  "t('adjustments.color.colorGrading')",
]) {
  if (!source.includes(marker)) {
    console.error(`Professional color workflow UI missing marker: ${marker}`);
    process.exit(1);
  }
}

console.log('professional color workflow UI ok');
