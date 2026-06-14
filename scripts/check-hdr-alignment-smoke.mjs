const WIDTH = 64;
const HEIGHT = 48;
const SEARCH_RADIUS = 5;
const MAX_ALLOWED_TRANSLATION_ERROR_PX = 0;
const MAX_ALLOWED_RMS_ERROR = 0.000001;
const MIN_OVERLAP_RATIO = 0.75;

const baseImage = createSyntheticHdrReference(WIDTH, HEIGHT);
const fixtures = [
  {
    label: 'under_exposed_shifted_right_up',
    shift: { x: 2, y: -1 },
  },
  {
    label: 'reference',
    shift: { x: 0, y: 0 },
  },
  {
    label: 'over_exposed_shifted_left_down',
    shift: { x: -3, y: 2 },
  },
];

const sources = fixtures.map((fixture, sourceIndex) => ({
  ...fixture,
  image: shiftImage(baseImage, WIDTH, HEIGHT, fixture.shift.x, fixture.shift.y),
  sourceIndex,
}));

const referenceSource = sources.find((source) => source.label === 'reference');
if (referenceSource === undefined) {
  throw new Error('HDR alignment smoke requires a reference source.');
}

const transforms = sources.map((source) => {
  const estimated = estimateTranslation(referenceSource.image, source.image, WIDTH, HEIGHT, SEARCH_RADIUS);
  const expected = {
    x: -source.shift.x,
    y: -source.shift.y,
  };
  const translationErrorPx =
    Math.abs(estimated.translation.x - expected.x) + Math.abs(estimated.translation.y - expected.y);

  if (translationErrorPx > MAX_ALLOWED_TRANSLATION_ERROR_PX) {
    throw new Error(
      `Expected ${source.label} translation ${formatPoint(expected)}, got ${formatPoint(estimated.translation)}.`,
    );
  }

  if (estimated.rmsError > MAX_ALLOWED_RMS_ERROR) {
    throw new Error(`Expected ${source.label} RMS <= ${MAX_ALLOWED_RMS_ERROR}, got ${estimated.rmsError}.`);
  }

  if (estimated.overlapRatio < MIN_OVERLAP_RATIO) {
    throw new Error(`Expected ${source.label} overlap >= ${MIN_OVERLAP_RATIO}, got ${estimated.overlapRatio}.`);
  }

  return {
    confidence: 1 - estimated.rmsError,
    expectedTranslationPx: expected,
    overlapRatio: estimated.overlapRatio,
    rmsError: estimated.rmsError,
    sourceIndex: source.sourceIndex,
    transformType: expected.x === 0 && expected.y === 0 ? 'identity' : 'translation',
    translationPx: estimated.translation,
  };
});

console.log(
  JSON.stringify(
    {
      alignmentConfidence: Math.min(...transforms.map((transform) => transform.confidence)),
      fixture: 'synthetic_hdr_translation_v1',
      referenceSourceIndex: referenceSource.sourceIndex,
      searchRadiusPx: SEARCH_RADIUS,
      transforms,
    },
    null,
    2,
  ),
);

function createSyntheticHdrReference(width, height) {
  const image = new Float64Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gradient = x / width + y / height;
      const verticalStripe = x % 11 === 0 ? 0.7 : 0;
      const horizontalStripe = y % 13 === 0 ? 0.5 : 0;
      const target = isInsideCircle(x, y, 19, 17, 7) || isInsideCircle(x, y, 43, 31, 5) ? 1.2 : 0;
      image[getPixelIndex(x, y, width)] = gradient + verticalStripe + horizontalStripe + target;
    }
  }

  return image;
}

function shiftImage(image, width, height, shiftX, shiftY) {
  const shifted = new Float64Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - shiftX;
      const sourceY = y - shiftY;
      if (isInsideImage(sourceX, sourceY, width, height)) {
        shifted[getPixelIndex(x, y, width)] = image[getPixelIndex(sourceX, sourceY, width)];
      }
    }
  }

  return shifted;
}

function estimateTranslation(reference, candidate, width, height, searchRadius) {
  let bestEstimate;

  for (let y = -searchRadius; y <= searchRadius; y += 1) {
    for (let x = -searchRadius; x <= searchRadius; x += 1) {
      const estimate = scoreTranslation(reference, candidate, width, height, x, y);

      if (bestEstimate === undefined || estimate.rmsError < bestEstimate.rmsError) {
        bestEstimate = estimate;
      }
    }
  }

  if (bestEstimate === undefined) {
    throw new Error('HDR alignment smoke could not evaluate any translation candidates.');
  }

  return bestEstimate;
}

function scoreTranslation(reference, candidate, width, height, translationX, translationY) {
  let squaredError = 0;
  let overlapCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const candidateX = x - translationX;
      const candidateY = y - translationY;
      if (!isInsideImage(candidateX, candidateY, width, height)) continue;

      const delta = reference[getPixelIndex(x, y, width)] - candidate[getPixelIndex(candidateX, candidateY, width)];
      squaredError += delta * delta;
      overlapCount += 1;
    }
  }

  if (overlapCount === 0) {
    return {
      overlapRatio: 0,
      rmsError: Number.POSITIVE_INFINITY,
      translation: {
        x: translationX,
        y: translationY,
      },
    };
  }

  return {
    overlapRatio: overlapCount / (width * height),
    rmsError: Math.sqrt(squaredError / overlapCount),
    translation: {
      x: translationX,
      y: translationY,
    },
  };
}

function isInsideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY) <= radius * radius;
}

function isInsideImage(x, y, width, height) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < width && y >= 0 && y < height;
}

function getPixelIndex(x, y, width) {
  return y * width + x;
}

function formatPoint(point) {
  return `(${point.x}, ${point.y})`;
}
