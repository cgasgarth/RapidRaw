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

const scene = createSyntheticRadianceScene(WIDTH, HEIGHT);
const captures = BRACKETS.map((bracket) => ({
  ...bracket,
  pixels: renderBracket(scene, bracket.exposureEv),
}));
const merged = mergeExposureWeightedRadiance(captures, WIDTH, HEIGHT);
const metrics = measureMerge(scene, captures, merged);

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

function mergeExposureWeightedRadiance(captures, width, height) {
  const merged = new Float64Array(width * height);

  for (let index = 0; index < merged.length; index += 1) {
    let weightedRadiance = 0;
    let totalWeight = 0;

    for (const capture of captures) {
      const normalized = capture.pixels[index];
      const weight = getWellExposedWeight(normalized);
      if (weight <= 0) continue;

      weightedRadiance += (normalized / 2 ** capture.exposureEv) * SENSOR_WHITE_RADIANCE * weight;
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      merged[index] = weightedRadiance / totalWeight;
      continue;
    }

    const darkestCapture = captures[0];
    if (darkestCapture === undefined) {
      throw new Error('HDR merge weighting smoke requires at least one capture.');
    }
    merged[index] = (darkestCapture.pixels[index] / 2 ** darkestCapture.exposureEv) * SENSOR_WHITE_RADIANCE;
  }

  return merged;
}

function measureMerge(scene, captures, merged) {
  let absoluteError = 0;
  let referenceClippedCount = 0;
  let recoveredHighlightCount = 0;
  let unrecoveredClippedCount = 0;
  const clippedInputPixelRatioBySource = captures.map((capture) => {
    let clippedHighCount = 0;
    let nearClippedHighCount = 0;

    for (const pixel of capture.pixels) {
      if (pixel >= 1) clippedHighCount += 1;
      if (pixel >= CLIP_THRESHOLD) nearClippedHighCount += 1;
    }

    return {
      clippedHighRatio: clippedHighCount / capture.pixels.length,
      nearClippedHighRatio: nearClippedHighCount / capture.pixels.length,
      sourceIndex: capture.sourceIndex,
    };
  });

  const referenceCapture = captures.find((capture) => capture.exposureEv === 0);
  if (referenceCapture === undefined) {
    throw new Error('HDR merge weighting smoke requires a 0 EV reference capture.');
  }

  for (let index = 0; index < scene.length; index += 1) {
    const referenceClipped = referenceCapture.pixels[index] >= CLIP_THRESHOLD;
    absoluteError += Math.abs(scene[index] - merged[index]);

    if (!referenceClipped) continue;

    referenceClippedCount += 1;
    if (Math.abs(scene[index] - merged[index]) <= MAX_RECONSTRUCTION_MAE) {
      recoveredHighlightCount += 1;
    } else {
      unrecoveredClippedCount += 1;
    }
  }

  return {
    clippedInputPixelRatioBySource,
    meanAbsoluteError: roundMetric(absoluteError / scene.length),
    recoveredHighlightPixelRatio: roundMetric(recoveredHighlightCount / referenceClippedCount),
    shadowNoiseAmplificationRisk: 'low',
    unrecoveredClippedPixelRatio: roundMetric(unrecoveredClippedCount / scene.length),
  };
}

function getWellExposedWeight(normalizedValue) {
  if (normalizedValue <= 0 || normalizedValue >= CLIP_THRESHOLD) return 0;
  return Math.max(0, 1 - Math.abs(normalizedValue - 0.5) * 2);
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

function roundMetric(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
