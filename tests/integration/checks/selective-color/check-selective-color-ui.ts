#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const colorLocale = locale.adjustments?.color;
const requiredLocaleKeys = [
  'ariaSelectColor',
  'colorMixer',
  'hue',
  'luminance',
  'falloffSmoothness',
  'rangeCenter',
  'rangeWidth',
  'resetActiveRange',
  'saturation',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof colorLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing selective color UI locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/adjustments/color/ColorMixerControls.tsx', 'utf8');
for (const marker of [
  'data-testid="selective-color-range-controls"',
  'data-testid="selective-color-range-disclosure"',
  'data-testid="selective-color-reset-active-range"',
  'data-testid="selective-color-range-shape-controls"',
  'data-dirty={String(hasActiveRangeChanges)}',
  'resetActiveRange',
  'handleRangeControlChange',
  'adjustments.color.rangeCenter',
  'adjustments.color.rangeWidth',
  'adjustments.color.falloffSmoothness',
  'adjustments.color.resetActiveRange',
]) {
  if (!source.includes(marker)) {
    console.error(`Selective color UI missing active range marker: ${marker}`);
    process.exit(1);
  }
}

console.log('selective color UI ok');
