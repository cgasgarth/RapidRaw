const WIDTH = 64;
const HEIGHT = 48;
const SENSOR_WHITE_RADIANCE = 1;
const BRACKETS = [
  { exposureEv: -2, sourceIndex: 0 },
  { exposureEv: 0, sourceIndex: 1 },
  { exposureEv: 2, sourceIndex: 2 },
];
const CLIP_THRESHOLD = 0.99;
const MIN_RECOVERED_HIGHLIGHT_RATIO = 0.9;
const MAX_UNRECOVERED_CLIPPED_RATIO = 0.03;
const MAX_RECONSTRUCTION_MAE = 0.015;

import {
  measureHdrMergeWeightingV1,
  mergeExposureWeightedRadianceV1,
} from '../../../../packages/rawengine-schema/src/hdr/hdrMergeWeightingRuntime.ts';

const scene = createSyntheticRadianceScene(WIDTH, HEIGHT);
const captures = BRACKETS.map((bracket) => ({
  ...bracket,
  pixels: renderBracket(scene, bracket.exposureEv),
}));
const merged = mergeExposureWeightedRadianceV1({
  captures,
  clipThreshold: CLIP_THRESHOLD,
  height: HEIGHT,
  sensorWhiteRadiance: SENSOR_WHITE_RADIANCE,
  width: WIDTH,
});
const metrics = measureHdrMergeWeightingV1({
  captures,
  clipThreshold: CLIP_THRESHOLD,
  maxReconstructionMae: MAX_RECONSTRUCTION_MAE,
  merged,
  scene,
});

if (metrics.recoveredHighlightPixelRatio < MIN_RECOVERED_HIGHLIGHT_RATIO) {
  throw new Error(
    `Expected recovered highlight ratio >= ${MIN_RECOVERED_HIGHLIGHT_RATIO}, got ${metrics.recoveredHighlightPixelRatio}.`,
  );
}

if (metrics.unrecoveredClippedPixelRatio > MAX_UNRECOVERED_CLIPPED_RATIO) {
  throw new Error(
    `Expected unrecovered clipped ratio <= ${MAX_UNRECOVERED_CLIPPED_RATIO}, got ${metrics.unrecoveredClippedPixelRatio}.`,
  );
}

if (metrics.meanAbsoluteError > MAX_RECONSTRUCTION_MAE) {
  throw new Error(`Expected mean absolute error <= ${MAX_RECONSTRUCTION_MAE}, got ${metrics.meanAbsoluteError}.`);
}

console.log(
  JSON.stringify(
    {
      brackets: BRACKETS,
      fixture: 'synthetic_hdr_merge_weighting_v1',
      metrics,
    },
    null,
    2,
  ),
);

function createSyntheticRadianceScene(width, height) {
  const pixels = new Float64Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.08 + (x / (width - 1)) * 1.7;
      const windowHighlight = isInsideRectangle(x, y, 39, 8, 18, 15) ? 2.35 : 0;
      const lampHighlight = isInsideCircle(x, y, 18, 32, 6) ? 1.4 : 0;
      const shadowDetail = isInsideRectangle(x, y, 4, 6, 16, 16) ? 0.06 : 0;
      pixels[getPixelIndex(x, y, width)] = gradient + windowHighlight + lampHighlight + shadowDetail;
    }
  }

  return pixels;
}

function renderBracket(scene, exposureEv) {
  const exposureScale = 2 ** exposureEv;
  const pixels = new Float64Array(scene.length);

  for (let index = 0; index < scene.length; index += 1) {
    pixels[index] = Math.min(1, (scene[index] * exposureScale) / SENSOR_WHITE_RADIANCE);
  }

  return pixels;
}

function isInsideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY) <= radius * radius;
}

function isInsideRectangle(x, y, left, top, width, height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}
