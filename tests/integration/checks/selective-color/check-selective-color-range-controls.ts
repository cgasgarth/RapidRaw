#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import {
  calculateSelectiveColorMaskWeight,
  type RgbPixel,
  renderSelectiveColorMaskPreviewPixel,
} from '../../../../src/utils/color/selective/selectiveColorRuntime.ts';

const orangePixel: RgbPixel = { blue: 0.08, green: 0.38, red: 0.92 };
const yellowPixel: RgbPixel = { blue: 0.08, green: 0.78, red: 0.92 };
const shiftedControls = {
  oranges: {
    centerHueDegrees: 42,
    falloffSmoothness: 0.5,
    widthDegrees: 90,
  },
};
const narrowControls = {
  oranges: {
    centerHueDegrees: 25,
    falloffSmoothness: 4,
    widthDegrees: 20,
  },
};

const defaultOrangeWeight = calculateSelectiveColorMaskWeight(orangePixel, 'oranges');
const shiftedYellowWeight = calculateSelectiveColorMaskWeight(yellowPixel, 'oranges', shiftedControls);
const narrowYellowWeight = calculateSelectiveColorMaskWeight(yellowPixel, 'oranges', narrowControls);
const shiftedPreview = renderSelectiveColorMaskPreviewPixel(yellowPixel, 'oranges', shiftedControls);

if (defaultOrangeWeight <= 0.45) {
  throw new Error(`Expected default orange range to target orange sample, got ${defaultOrangeWeight.toFixed(4)}.`);
}

if (shiftedYellowWeight <= narrowYellowWeight * 2) {
  throw new Error(
    `Expected wider/smoother shifted range to include more yellow-orange pixels (${shiftedYellowWeight.toFixed(
      4,
    )} <= ${narrowYellowWeight.toFixed(4)}).`,
  );
}

if (Math.abs(shiftedPreview.red - shiftedYellowWeight) > 0.0001) {
  throw new Error('Mask preview pixel did not use custom selective color range controls.');
}

const colorPanelSource = readFileSync('src/components/adjustments/color/ColorMixerControls.tsx', 'utf8');
for (const marker of [
  'data-scope="local-adjustment"',
  'data-testid="local-color-range-adjustment-controls"',
  "handleRangeControlChange('centerHueDegrees'",
  "handleRangeControlChange('widthDegrees'",
  "handleRangeControlChange('falloffSmoothness'",
]) {
  if (!colorPanelSource.includes(marker)) throw new Error(`Missing selective color range control marker: ${marker}`);
}

console.log(
  `selective color range controls ok (default=${defaultOrangeWeight.toFixed(3)}, shifted=${shiftedYellowWeight.toFixed(
    3,
  )}, narrow=${narrowYellowWeight.toFixed(3)})`,
);
