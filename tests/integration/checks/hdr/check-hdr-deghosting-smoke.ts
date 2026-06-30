const WIDTH = 72;
const HEIGHT = 48;
const MOTION_THRESHOLD = 0.22;
const MIN_RECALL = 0.95;
const MIN_PRECISION = 0.9;
const MAX_GHOST_MAE = 0.01;

import {
  countHdrMotionPixelsV1,
  detectHdrMotionMaskV1,
  measureHdrMotionMaskV1,
  measureHdrMotionRegionMaeV1,
  mergeHdrWithReferenceInMotionRegionsV1,
} from '../../../../packages/rawengine-schema/src/hdr/hdrDeghostRuntime.ts';

const background = createBackground(WIDTH, HEIGHT);
const objectMasks = [
  createRectangleMask(WIDTH, HEIGHT, 8, 20, 10, 10),
  createRectangleMask(WIDTH, HEIGHT, 31, 20, 10, 10),
  createRectangleMask(WIDTH, HEIGHT, 54, 20, 10, 10),
];
const expectedMotionMask = unionMasks(objectMasks);
const frames = objectMasks.map((mask, sourceIndex) => ({
  height: HEIGHT,
  pixels: compositeMovingObject(background, mask),
  sourceIndex,
  width: WIDTH,
}));
const referenceFrame = frames[1];

if (referenceFrame === undefined) {
  throw new Error('HDR deghosting smoke requires a reference frame.');
}

const request = {
  frames,
  motionThreshold: MOTION_THRESHOLD,
  referenceSourceIndex: referenceFrame.sourceIndex,
};
const detectedMotionMask = detectHdrMotionMaskV1(request);
const metrics = measureHdrMotionMaskV1(expectedMotionMask, detectedMotionMask);
const deghosted = mergeHdrWithReferenceInMotionRegionsV1(request, detectedMotionMask);
const ghostMeanAbsoluteError = measureHdrMotionRegionMaeV1(referenceFrame.pixels, deghosted, expectedMotionMask);

if (metrics.recall < MIN_RECALL) {
  throw new Error(`Expected deghosting motion-mask recall >= ${MIN_RECALL}, got ${metrics.recall}.`);
}

if (metrics.precision < MIN_PRECISION) {
  throw new Error(`Expected deghosting motion-mask precision >= ${MIN_PRECISION}, got ${metrics.precision}.`);
}

if (ghostMeanAbsoluteError > MAX_GHOST_MAE) {
  throw new Error(`Expected deghosted motion-region MAE <= ${MAX_GHOST_MAE}, got ${ghostMeanAbsoluteError}.`);
}

console.log(
  JSON.stringify(
    {
      fixture: 'synthetic_hdr_deghosting_v1',
      ghostMeanAbsoluteError,
      metrics,
      motionCoverageRatio: roundMetric(countHdrMotionPixelsV1(detectedMotionMask) / detectedMotionMask.length),
      referenceSourceIndex: 1,
      threshold: MOTION_THRESHOLD,
    },
    null,
    2,
  ),
);

function createBackground(width, height) {
  const image = new Float64Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = 0.12 + x / width + y / (height * 2);
      const window = x > 45 && y < 16 ? 1.2 : 0;
      image[getPixelIndex(x, y, width)] = gradient + window;
    }
  }

  return image;
}

function createRectangleMask(width, height, left, top, rectWidth, rectHeight) {
  const mask = new Uint8Array(width * height);

  for (let y = top; y < top + rectHeight; y += 1) {
    for (let x = left; x < left + rectWidth; x += 1) {
      mask[getPixelIndex(x, y, width)] = 1;
    }
  }

  return mask;
}

function unionMasks(masks) {
  const [firstMask] = masks;
  if (firstMask === undefined) {
    throw new Error('HDR deghosting smoke requires at least one mask.');
  }

  const union = new Uint8Array(firstMask.length);
  for (const mask of masks) {
    for (let index = 0; index < mask.length; index += 1) {
      union[index] = union[index] === 1 || mask[index] === 1 ? 1 : 0;
    }
  }
  return union;
}

function compositeMovingObject(background, mask) {
  const image = new Float64Array(background);

  for (let index = 0; index < image.length; index += 1) {
    if (mask[index] === 1) {
      image[index] = 2.1;
    }
  }

  return image;
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}

function roundMetric(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
