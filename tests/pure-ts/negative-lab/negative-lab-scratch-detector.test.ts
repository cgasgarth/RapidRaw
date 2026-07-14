import { describe, expect, test } from 'bun:test';

import { detectNegativeLabLongScratches } from '../../../src/utils/negative-lab/negativeLabScratchDetector';

const raster = (width: number, height: number, fill: number, patch?: (x: number, y: number) => number): number[] =>
  Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return patch?.(x, y) ?? fill;
  });

describe('Negative Lab native-buffer long-scratch detector', () => {
  test('localizes an elongated image-grounded stripe with bounded polyline geometry', () => {
    const width = 64;
    const height = 48;
    const candidates = detectNegativeLabLongScratches({
      cropIdentity: 'crop:fixture',
      height,
      pixels: raster(width, height, 0.5, (x, y) => (x >= 29 && x <= 31 && y > 3 && y < height - 4 ? 0.15 : 0.5)),
      processIdentity: 'negative-log-density-v1',
      sourceIdentity: 'sha256:fixture',
      width,
    });
    const candidate = candidates[0];
    expect(candidate?.detectorVersion).toBe('native_buffer_ridge_v1');
    expect(candidate?.geometry.kind).toBe('polyline');
    expect(candidate?.geometry.points.length).toBe(9);
    expect(candidate?.geometry.x).toBeGreaterThan(0.35);
    expect(candidate?.geometry.x).toBeLessThan(0.55);
    expect(candidate?.supportCount).toBeGreaterThan(20);
  });

  test('rejects clean and border-only fields', () => {
    const width = 64;
    const height = 48;
    expect(
      detectNegativeLabLongScratches({
        cropIdentity: 'crop:clean',
        height,
        pixels: raster(width, height, 0.5),
        processIdentity: 'negative-log-density-v1',
        sourceIdentity: 'sha256:clean',
        width,
      }),
    ).toEqual([]);
    expect(
      detectNegativeLabLongScratches({
        cropIdentity: 'crop:border',
        height,
        pixels: raster(width, height, 0.5, (x) => (x < 2 ? 0.1 : 0.5)),
        processIdentity: 'negative-log-density-v1',
        sourceIdentity: 'sha256:border',
        width,
      }),
    ).toEqual([]);
  });
});
