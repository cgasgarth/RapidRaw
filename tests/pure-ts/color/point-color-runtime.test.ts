import { describe, expect, test } from 'bun:test';
import type { PointColorAdjustmentV1 } from '../../../packages/rawengine-schema/src/color/pointColorSchemas';
import {
  applyPointColorCoordinate,
  applySkinUniformityCoordinate,
  circularHueDistanceDegrees,
  pointColorMaskWeight,
  pointColorMembershipWeight,
  pointColorVisualizationWeight,
} from '../../../src/utils/color/pointColorRuntime';

const point = (hueDegrees = 359): PointColorAdjustmentV1 => ({
  chromaRadius: 0.08,
  chromaShift: 0,
  enabled: true,
  feather: 0.4,
  hueRadiusDegrees: 25,
  hueShiftDegrees: 20,
  id: 'red',
  lightnessRadius: 0.2,
  lightnessShift: 0,
  name: 'Red fabric',
  opacity: 1,
  samples: [
    {
      confidence: 1,
      graphRevision: 'graph-1',
      id: 'sample-1',
      sampleRadiusPx: 5,
      sourceColor: { chroma: 0.15, hueDegrees, lightness: 0.6 },
      sourceSceneRevision: 'scene-1',
    },
  ],
  saturationShift: 0,
  variance: 1,
});

describe('Point Color perceptual runtime', () => {
  test('wraps red hue and keeps membership/edit/visualization/mask on one weight', () => {
    expect(circularHueDistanceDegrees(359, 1)).toBe(2);
    const adjustment = point();
    const color = { chroma: 0.15, hueDegrees: 1, lightness: 0.6 };
    const membership = pointColorMembershipWeight(color, adjustment);
    expect(membership).toBeGreaterThan(0.95);
    expect(pointColorVisualizationWeight(color, adjustment)).toBe(membership);
    expect(pointColorMaskWeight(color, adjustment)).toBe(membership);
    expect(applyPointColorCoordinate(color, adjustment).hueDegrees).toBeCloseTo(1 + 20 * membership, 8);
  });

  test('supports multiple samples without order dependence and rejects neutrals', () => {
    const adjustment = point(20);
    adjustment.samples.push({
      ...adjustment.samples[0],
      confidence: 0.75,
      id: 'sample-2',
      sourceColor: { chroma: 0.12, hueDegrees: 30, lightness: 0.55 },
    });
    const color = { chroma: 0.13, hueDegrees: 27, lightness: 0.58 };
    const forward = pointColorMembershipWeight(color, adjustment);
    adjustment.samples.reverse();
    expect(pointColorMembershipWeight(color, adjustment)).toBeCloseTo(forward, 12);
    expect(pointColorMembershipWeight({ ...color, chroma: 0 }, adjustment)).toBe(0);
  });

  test('moves skin axes independently without a proxy HSL channel', () => {
    const range = point(30);
    const color = { chroma: 0.15, hueDegrees: 30, lightness: 0.6 };
    const output = applySkinUniformityCoordinate(color, {
      chromaUniformity: 0,
      enabled: true,
      hueUniformity: 1,
      lightnessUniformity: 0,
      preserveExtremes: 0,
      range,
      target: { chroma: 0.2, hueDegrees: 50, lightness: 0.7 },
    });
    expect(output.hueDegrees).toBeCloseTo(50, 8);
    expect(output.chroma).toBe(color.chroma);
    expect(output.lightness).toBe(color.lightness);
  });
});
