#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const colorLocale = locale.adjustments?.color;
const requiredLocaleKeys = [
  'activeRangeAdjustedHue',
  'activeRangeDeltas',
  'ariaSelectColor',
  'colorMixer',
  'hue',
  'luminance',
  'resetActiveRange',
  'saturation',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof colorLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing selective color UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/adjustments/Color.tsx', 'utf8');
for (const marker of [
  'data-testid="selective-color-range-summary"',
  'data-testid="selective-color-adjusted-hue"',
  'data-testid="selective-color-hsl-deltas"',
  'data-testid="selective-color-reset-active-range"',
  'data-dirty={String(isActiveSelectiveColorAdjusted)}',
  'resetActiveSelectiveColorRange',
  'adjustments.color.activeRangeAdjustedHue',
  'adjustments.color.activeRangeDeltas',
  'adjustments.color.resetActiveRange',
]) {
  if (!source.includes(marker)) {
    console.error(`Selective color UI missing active range marker: ${marker}`);
    process.exit(1);
  }
}

console.log('selective color UI ok');
