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
  'adjustedPreviewEnabled',
  'maskPreview',
  'maskPreviewEnabled',
  'previewMode',
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
  'data-testid="selective-color-range-summary"',
  'data-testid="selective-color-adjusted-hue"',
  'data-testid="selective-color-hsl-deltas"',
  'data-testid="selective-color-reset-active-range"',
  'data-testid="selective-color-mask-preview-toggle"',
  'data-testid="selective-color-preview-mode"',
  'data-testid="selective-color-range-shape-controls"',
  'data-testid="selective-color-range-summary-falloff"',
  'data-dirty={String(isActiveSelectiveColorAdjusted)}',
  'data-preview-mutates-adjustments="false"',
  'data-preview-source="selectiveColorRuntime.renderSelectiveColorMaskPreviewPixel"',
  'resetActiveSelectiveColorRange',
  'toggleSelectiveColorPreviewMode',
  'adjustments.color.activeRangeAdjustedHue',
  'adjustments.color.activeRangeDeltas',
  'adjustments.color.maskPreview',
  'adjustments.color.previewMode',
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
