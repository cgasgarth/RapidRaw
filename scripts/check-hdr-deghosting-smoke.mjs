const WIDTH = 72;
const HEIGHT = 48;
const MOTION_THRESHOLD = 0.22;
const MIN_RECALL = 0.95;
const MIN_PRECISION = 0.9;
const MAX_GHOST_MAE = 0.01;

const background = createBackground(WIDTH, HEIGHT);
const objectMasks = [
  createRectangleMask(WIDTH, HEIGHT, 8, 20, 10, 10),
  createRectangleMask(WIDTH, HEIGHT, 31, 20, 10, 10),
  createRectangleMask(WIDTH, HEIGHT, 54, 20, 10, 10),
];
const expectedMotionMask = unionMasks(objectMasks);
const frames = objectMasks.map((mask) => compositeMovingObject(background, mask));
const referenceFrame = frames[1];

if (referenceFrame === undefined) {
  throw new Error('HDR deghosting smoke requires a reference frame.');
}

const detectedMotionMask = detectMotionMask(frames, referenceFrame, MOTION_THRESHOLD);
const metrics = measureMask(expectedMotionMask, detectedMotionMask);
const deghosted = mergeWithReferenceInMotionRegions(frames, detectedMotionMask, referenceFrame);
const ghostMeanAbsoluteError = measureMotionRegionMae(referenceFrame, deghosted, expectedMotionMask);

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
      motionCoverageRatio: roundMetric(countTrue(detectedMotionMask) / detectedMotionMask.length),
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

function detectMotionMask(frames, referenceFrame, threshold) {
  const mask = new Uint8Array(referenceFrame.length);

  for (let index = 0; index < referenceFrame.length; index += 1) {
    const maxDelta = Math.max(...frames.map((frame) => Math.abs(frame[index] - referenceFrame[index])));
    mask[index] = maxDelta >= threshold ? 1 : 0;
  }

  return mask;
}

function mergeWithReferenceInMotionRegions(frames, motionMask, referenceFrame) {
  const merged = new Float64Array(referenceFrame.length);

  for (let index = 0; index < merged.length; index += 1) {
    if (motionMask[index] === 1) {
      merged[index] = referenceFrame[index];
      continue;
    }

    merged[index] = frames.reduce((total, frame) => total + frame[index], 0) / frames.length;
  }

  return merged;
}

function measureMask(expectedMask, detectedMask) {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (let index = 0; index < expectedMask.length; index += 1) {
    if (expectedMask[index] === 1 && detectedMask[index] === 1) truePositive += 1;
    if (expectedMask[index] === 0 && detectedMask[index] === 1) falsePositive += 1;
    if (expectedMask[index] === 1 && detectedMask[index] === 0) falseNegative += 1;
  }

  return {
    falseNegative,
    falsePositive,
    precision: roundMetric(truePositive / (truePositive + falsePositive)),
    recall: roundMetric(truePositive / (truePositive + falseNegative)),
    truePositive,
  };
}

function measureMotionRegionMae(referenceFrame, candidateFrame, motionMask) {
  let absoluteError = 0;
  let count = 0;

  for (let index = 0; index < motionMask.length; index += 1) {
    if (motionMask[index] !== 1) continue;
    absoluteError += Math.abs(referenceFrame[index] - candidateFrame[index]);
    count += 1;
  }

  if (count === 0) {
    throw new Error('HDR deghosting smoke expected a non-empty motion region.');
  }

  return roundMetric(absoluteError / count);
}

function countTrue(mask) {
  return mask.reduce((total, value) => total + value, 0);
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}

function roundMetric(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
