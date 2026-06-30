#!/usr/bin/env bun

import {
  NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION,
  parseNegativeLabFrameRgbBalanceOverridePayload,
} from '../../../src/schemas/negative-lab/negativeLabFrameRgbBalanceOverrideSchemas.ts';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';
import {
  buildNegativeLabFrameRgbBalanceOverridePayload,
  getNegativeLabEffectiveFrameRgbBalance,
  negativeLabFrameRgbBalanceOffsetIsZero,
  snapNegativeLabFrameRgbBalanceOffsets,
} from '../../../src/utils/negativeLabFrameRgbBalanceOverrides.ts';

const sourcePaths = ['/roll/frame-001.tif', '/roll/frame-002.tif'];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.91,
  baseScope: 'roll',
  includedPathSet: new Set(sourcePaths),
  previewReady: true,
  targetPaths: sourcePaths,
});
const baselineParams = {
  base_fog_sample: null,
  base_fog_strength: 1,
  black_point: 0,
  blue_weight: 1,
  contrast: 1,
  exposure: 0,
  green_weight: 0.95,
  red_weight: 1.05,
  white_point: 1,
};

const payload = buildNegativeLabFrameRgbBalanceOverridePayload({
  baselineParams,
  frameHealthRows: frameHealthReport.frames,
  offsetsByFrameId: {
    'negative-lab-frame-1': { blueWeight: 0.12, greenWeight: -0.04, redWeight: 0.13 },
    'negative-lab-frame-2': { blueWeight: 0, greenWeight: 0, redWeight: 0 },
  },
});

if (
  payload.schemaVersion !== NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION ||
  payload.overrides.length !== 1 ||
  payload.overrides[0]?.rgbBalanceOffset.redWeight !== 0.13 ||
  payload.overrides[0]?.sourcePath !== sourcePaths[0]
) {
  throw new Error('Negative Lab frame RGB balance override payload did not capture one effective override.');
}

const effectiveBalance = getNegativeLabEffectiveFrameRgbBalance({
  baselineParams,
  frameId: 'negative-lab-frame-1',
  offsetsByFrameId: { 'negative-lab-frame-1': { blueWeight: 0.12, greenWeight: -0.04, redWeight: 0.13 } },
});
if (
  effectiveBalance.redWeight !== 1.18 ||
  effectiveBalance.greenWeight !== 0.91 ||
  effectiveBalance.blueWeight !== 1.12
) {
  throw new Error('Negative Lab effective RGB balance did not include active frame offsets.');
}

const clampedOffset = snapNegativeLabFrameRgbBalanceOffsets({
  baselineParams,
  offsets: { blueWeight: 9, greenWeight: -9, redWeight: 0.333 },
});
if (clampedOffset.blueWeight !== 1 || clampedOffset.greenWeight !== -0.45 || clampedOffset.redWeight !== 0.33) {
  throw new Error('Negative Lab frame RGB balance offset snapping did not preserve bounded 0.01 steps.');
}

if (
  !negativeLabFrameRgbBalanceOffsetIsZero(
    snapNegativeLabFrameRgbBalanceOffsets({
      baselineParams,
      offsets: { blueWeight: 0, greenWeight: 0, redWeight: 0 },
    }),
  )
) {
  throw new Error('Negative Lab frame RGB balance zero-offset detection failed.');
}

for (const invalidPayload of [
  {
    overrides: [
      {
        frameId: 'a',
        rgbBalanceOffset: { blueWeight: 0.1, greenWeight: 0, redWeight: 0 },
        sourcePath: '/a.tif',
      },
      {
        frameId: 'a',
        rgbBalanceOffset: { blueWeight: 0.2, greenWeight: 0, redWeight: 0 },
        sourcePath: '/b.tif',
      },
    ],
    schemaVersion: NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION,
  },
  {
    overrides: [
      {
        frameId: 'c',
        rgbBalanceOffset: { blueWeight: 0.123, greenWeight: 0, redWeight: 0 },
        sourcePath: '/c.tif',
      },
    ],
    schemaVersion: NEGATIVE_LAB_FRAME_RGB_BALANCE_OVERRIDE_SCHEMA_VERSION,
  },
]) {
  const acceptedInvalidPayload = (() => {
    try {
      parseNegativeLabFrameRgbBalanceOverridePayload(invalidPayload);
      return true;
    } catch {
      return false;
    }
  })();

  if (acceptedInvalidPayload) {
    throw new Error('Negative Lab frame RGB balance override schema accepted an invalid payload.');
  }
}

console.log('negative lab frame rgb balance override ok');
