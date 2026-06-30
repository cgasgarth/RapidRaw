import { describe, expect, test } from 'bun:test';

import { negativeLabScanMetricsV1Schema } from '../../../src/schemas/negative-lab/negativeLabScanMetricsSchemas.ts';
import {
  buildNegativeLabScanMetricsV1,
  type NegativeLabScanMetricPixel,
} from '../../../src/utils/negative-lab/negativeLabScanMetrics.ts';

const buildPixels = (width: number, height: number, getPixel: (x: number, y: number) => NegativeLabScanMetricPixel) =>
  Array.from({ length: width * height }, (_, index) => getPixel(index % width, Math.floor(index / width)));

const expectFiniteMetricNumbers = (value: unknown) => {
  const metrics = negativeLabScanMetricsV1Schema.parse(value);
  const numericValues = [
    metrics.densityRangeUnclamped,
    metrics.highDensityReference,
    metrics.lumaDensityPercentiles.p02,
    metrics.lumaDensityPercentiles.p10,
    metrics.lumaDensityPercentiles.p50,
    metrics.lumaDensityPercentiles.p90,
    metrics.lumaDensityPercentiles.p98,
    metrics.p50AnchorDensity,
    metrics.shadowReference,
    metrics.texturalDensityRangeP10P90,
    metrics.channels.red.deviationBounds.lower,
    metrics.channels.green.deviationBounds.upper,
    metrics.channels.blue.densityPercentiles.p50,
  ];
  for (const numericValue of numericValues) expect(Number.isFinite(numericValue)).toBe(true);
  expect(metrics.lumaDensityPercentiles.p02).toBeLessThanOrEqual(metrics.lumaDensityPercentiles.p10);
  expect(metrics.lumaDensityPercentiles.p10).toBeLessThanOrEqual(metrics.lumaDensityPercentiles.p50);
  expect(metrics.lumaDensityPercentiles.p50).toBeLessThanOrEqual(metrics.lumaDensityPercentiles.p90);
  expect(metrics.lumaDensityPercentiles.p90).toBeLessThanOrEqual(metrics.lumaDensityPercentiles.p98);
  return metrics;
};

describe('negative lab scan metrics', () => {
  test('excludes dense borders from the analysis mask', () => {
    const pixels = buildPixels(24, 24, (x, y) => {
      const border = x < 4 || y < 4 || x >= 20 || y >= 20;
      return border ? { b: 0.1, g: 0.12, r: 0.14 } : { b: 0.48, g: 0.5, r: 0.52 };
    });
    const insetMetrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 24, imageWidth: 24, insetFraction: 0.18, pixels }),
    );
    const fullMetrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 24, imageWidth: 24, insetFraction: 0, pixels }),
    );

    expect(insetMetrics.warningCodes).toContain('border_density_contamination');
    expect(insetMetrics.p50AnchorDensity).toBeLessThan(fullMetrics.p50AnchorDensity);
  });

  test('keeps robust ordering with orange mask cast and dust/specular outliers', () => {
    const pixels = buildPixels(32, 32, (x, y) => {
      if (x === 5 && y === 5) return { b: 0.02, g: 0.02, r: 0.02 };
      if (x === 26 && y === 26) return { b: 1.4, g: 1.3, r: 1.2 };
      const ramp = (x + y) / 96;
      return { b: 0.22 + ramp * 0.18, g: 0.36 + ramp * 0.2, r: 0.58 + ramp * 0.15 };
    });
    const metrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 32, imageWidth: 32, insetFraction: 0.06, pixels }),
    );

    expect(metrics.clippingCounts.unityOrHigherTransmittanceCount).toBe(3);
    expect(metrics.channels.blue.deviationBounds.upper).toBeGreaterThan(metrics.channels.red.deviationBounds.upper);
    expect(metrics.texturalDensityRangeP10P90).toBeGreaterThan(0.05);
  });

  test('reports fogged low-density and flat frames without producing non-finite outputs', () => {
    const pixels = buildPixels(18, 18, () => ({ b: 0.96, g: 0.97, r: 0.98 }));
    const metrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 18, imageWidth: 18, insetFraction: 0.1, pixels }),
    );

    expect(metrics.warningCodes).toContain('low_density_frame');
    expect(metrics.warningCodes).toContain('near_flat_density_field');
    expect(metrics.texturalDensityRangeP10P90).toBeCloseTo(0);
  });

  test('monochrome channels keep near-zero color-deviation bounds', () => {
    const pixels = buildPixels(20, 20, (x, y) => {
      const value = 0.2 + ((x + y) / 80) * 0.5;
      return { b: value, g: value, r: value };
    });
    const metrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 20, imageWidth: 20, insetFraction: 0.08, pixels }),
    );

    expect(Math.abs(metrics.channels.red.deviationBounds.lower)).toBeLessThan(1e-12);
    expect(Math.abs(metrics.channels.green.deviationBounds.upper)).toBeLessThan(1e-12);
    expect(Math.abs(metrics.channels.blue.deviationBounds.upper)).toBeLessThan(1e-12);
  });

  test('guards invalid and nonpositive transmittance samples', () => {
    const pixels = buildPixels(12, 12, (x, y) => {
      if (x === 6 && y === 6) return { b: 0, g: 0.3, r: 0.3 };
      if (x === 7 && y === 6) return { b: Number.NaN, g: 0.3, r: 0.3 };
      return { b: 0.32, g: 0.34, r: 0.36 };
    });
    const metrics = expectFiniteMetricNumbers(
      buildNegativeLabScanMetricsV1({ imageHeight: 12, imageWidth: 12, insetFraction: 0, pixels }),
    );

    expect(metrics.clippingCounts.invalidSampleCount).toBe(1);
    expect(metrics.clippingCounts.nonpositiveTransmittanceCount).toBe(1);
    expect(metrics.sampleCount).toBe(142);
  });
});
