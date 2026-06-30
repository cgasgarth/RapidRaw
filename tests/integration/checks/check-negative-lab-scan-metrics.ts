import { negativeLabScanMetricsV1Schema } from '../../../src/schemas/negative-lab/negativeLabScanMetricsSchemas.ts';
import { buildNegativeLabScanMetricsV1 } from '../../../src/utils/negativeLabScanMetrics.ts';

const pixels = Array.from({ length: 30 * 30 }, (_, index) => {
  const x = index % 30;
  const y = Math.floor(index / 30);
  const border = x < 3 || y < 3 || x >= 27 || y >= 27;
  const ramp = (x + y) / 80;
  return border ? { b: 0.12, g: 0.13, r: 0.15 } : { b: 0.28 + ramp * 0.08, g: 0.34 + ramp * 0.1, r: 0.5 + ramp * 0.12 };
});

const metrics = negativeLabScanMetricsV1Schema.parse(
  buildNegativeLabScanMetricsV1({ imageHeight: 30, imageWidth: 30, insetFraction: 0.12, pixels }),
);

if (metrics.schemaVersion !== 1 || metrics.sampleCount <= 0) {
  throw new Error('Negative Lab scan metrics did not produce a versioned sample set.');
}

if (metrics.p50AnchorDensity !== metrics.lumaDensityPercentiles.p50) {
  throw new Error('Negative Lab scan metrics P50 anchor is stale.');
}

if (metrics.highDensityReference < metrics.shadowReference) {
  throw new Error('Negative Lab scan metrics high-density reference must be above shadow reference.');
}

if (!metrics.warningCodes.includes('border_density_contamination')) {
  throw new Error('Negative Lab scan metrics did not flag contaminated borders.');
}

console.log(`negative lab scan metrics ok (${metrics.sampleCount} inset samples)`);
