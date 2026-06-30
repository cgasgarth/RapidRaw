#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { negativeLabPresetParamsSchema } from '../../../src/schemas/negative-lab/negativeLabPresetCatalogSchemas.ts';
import {
  convertNegativeLabDensitySamples,
  type NegativeLabRgbTriplet,
} from '../../../src/utils/negativeLabDensityConversion.ts';

const baseParams = negativeLabPresetParamsSchema.parse({
  base_fog_sample: null,
  base_fog_strength: 1,
  blue_weight: 1,
  contrast: 1,
  exposure: 0,
  green_weight: 1,
  red_weight: 1,
});

if (baseParams.black_point !== 0 || baseParams.white_point !== 1) {
  throw new Error('Negative Lab endpoint defaults were not applied by the params schema.');
}

const invalidEndpoints = negativeLabPresetParamsSchema.safeParse({
  ...baseParams,
  black_point: 0.9,
  white_point: 0.92,
});

if (invalidEndpoints.success) {
  throw new Error('Negative Lab params schema accepted black/white points with insufficient separation.');
}

const samples: NegativeLabRgbTriplet[] = [
  [0.9, 0.72, 0.54],
  [0.48, 0.36, 0.24],
  [0.16, 0.1, 0.06],
  [0.05, 0.035, 0.025],
];
const baseFog: NegativeLabRgbTriplet = [0.92, 0.74, 0.56];
const baseline = convertNegativeLabDensitySamples(samples, baseFog, baseParams);
const adjusted = convertNegativeLabDensitySamples(samples, baseFog, {
  ...baseParams,
  black_point: 0.18,
  white_point: 0.82,
});
const reset = convertNegativeLabDensitySamples(samples, baseFog, {
  ...baseParams,
  black_point: 0,
  white_point: 1,
});

const channelDelta = (left: readonly NegativeLabRgbTriplet[], right: readonly NegativeLabRgbTriplet[]) =>
  left.reduce(
    (total, sample, sampleIndex) =>
      total +
      sample.reduce(
        (sampleTotal, channel, channelIndex) =>
          sampleTotal + Math.abs(channel - (right[sampleIndex]?.[channelIndex] ?? channel)),
        0,
      ),
    0,
  );

if (channelDelta(baseline, adjusted) <= 0.25) {
  throw new Error('Negative Lab black/white point remap did not materially change CPU conversion output.');
}

if (channelDelta(baseline, reset) !== 0) {
  throw new Error('Negative Lab endpoint reset did not preserve default CPU conversion identity.');
}

const modalSource = await readFile('src/components/modals/negative-lab/NegativeConversionModal.tsx', 'utf8');
for (const marker of [
  'negative-lab-black-point-control',
  'negative-lab-white-point-control',
  'negative-lab-reset-print-endpoints',
  "handleParamChange('black_point'",
  "handleParamChange('white_point'",
]) {
  if (!modalSource.includes(marker)) {
    throw new Error(`Negative Lab endpoint UI marker missing: ${marker}`);
  }
}

console.log(`negative lab black/white points ok (delta ${channelDelta(baseline, adjusted).toFixed(3)})`);
