#!/usr/bin/env bun

import {
  NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION,
  parseNegativeLabFrameExposureOverridePayload,
} from '../../../src/schemas/negative-lab/negativeLabFrameExposureOverrideSchemas.ts';
import {
  buildNegativeLabFrameExposureOverridePayload,
  getNegativeLabEffectiveFrameExposure,
  snapNegativeLabFrameExposureOffset,
} from '../../../src/utils/negativeLabFrameExposureOverrides.ts';
import { buildNegativeLabFrameHealthReport } from '../../../src/utils/negativeLabFrameHealth.ts';

const sourcePaths = ['/roll/frame-001.tif', '/roll/frame-002.tif'];
const frameHealthReport = buildNegativeLabFrameHealthReport({
  activePathIndex: 0,
  baseFogConfidence: 0.91,
  baseScope: 'roll',
  includedPathSet: new Set(sourcePaths),
  previewReady: true,
  targetPaths: sourcePaths,
});

const payload = buildNegativeLabFrameExposureOverridePayload({
  baselineExposure: 0.25,
  frameHealthRows: frameHealthReport.frames,
  offsetsByFrameId: {
    'negative-lab-frame-1': 0.3,
    'negative-lab-frame-2': 0,
  },
});

if (
  payload.schemaVersion !== NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION ||
  payload.overrides.length !== 1 ||
  payload.overrides[0]?.effectiveExposure !== 0.55 ||
  payload.overrides[0]?.sourcePath !== sourcePaths[0]
) {
  throw new Error('Negative Lab frame exposure override payload did not capture one effective override.');
}

if (
  getNegativeLabEffectiveFrameExposure({
    baselineExposure: 0.25,
    frameId: 'negative-lab-frame-1',
    offsetsByFrameId: { 'negative-lab-frame-1': 0.3 },
  }) !== 0.55
) {
  throw new Error('Negative Lab effective exposure did not include active frame offset.');
}

if (snapNegativeLabFrameExposureOffset(0.333) !== 0.35 || snapNegativeLabFrameExposureOffset(9) !== 2) {
  throw new Error('Negative Lab exposure offset snapping did not use 0.05 EV bounded steps.');
}

for (const invalidPayload of [
  {
    overrides: [
      { effectiveExposure: 0.1, exposureOffset: 0.1, frameId: 'a', sourcePath: '/a.tif' },
      { effectiveExposure: 0.2, exposureOffset: 0.2, frameId: 'a', sourcePath: '/b.tif' },
    ],
    schemaVersion: NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION,
  },
  {
    overrides: [{ effectiveExposure: 0.333, exposureOffset: 0.333, frameId: 'c', sourcePath: '/c.tif' }],
    schemaVersion: NEGATIVE_LAB_FRAME_EXPOSURE_OVERRIDE_SCHEMA_VERSION,
  },
]) {
  const acceptedInvalidPayload = (() => {
    try {
      parseNegativeLabFrameExposureOverridePayload(invalidPayload);
      return true;
    } catch {
      return false;
    }
  })();

  if (acceptedInvalidPayload) {
    throw new Error('Negative Lab frame exposure override schema accepted an invalid payload.');
  }
}

console.log('negative lab frame exposure override ok');
