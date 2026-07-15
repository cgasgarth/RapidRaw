import { expect, test } from 'bun:test';
import { resolveImageRenderSize } from '../../../src/hooks/viewport/useImageRenderSize';
import {
  areRenderSizesEquivalent,
  hasMaterialRenderSizeChange,
  type RenderSize,
  RenderSizePublicationQueue,
} from '../../../src/utils/renderSizePublication';

const measuredAt = (containerHeight: number) =>
  resolveImageRenderSize({ height: containerHeight, width: 606 }, { height: 768, width: 1024 });

test('coalesces an oscillating layout burst back to the last stable render size', () => {
  const stable = measuredAt(397);
  const queue = new RenderSizePublicationQueue(stable);

  for (const height of [804, 959, 1504, 1505, 1506, 1508, 1510, 1511, 1513, 1514, 1515, 1504, 397]) {
    queue.observe(measuredAt(height));
  }

  expect(queue.flush()).toBeNull();
  expect(queue.snapshot()).toEqual(stable);

  const legitimateResize = resolveImageRenderSize({ height: 500, width: 700 }, { height: 768, width: 1024 });
  queue.observe(legitimateResize);
  expect(queue.flush()).toEqual(legitimateResize);
  expect(queue.flush()).toBeNull();
});

test('treats half-pixel layout jitter as equivalent without hiding material geometry changes', () => {
  const stable: RenderSize = { height: 454.5, offsetX: 0, offsetY: 525.25, scale: 0.591_796_875, width: 606 };
  expect(
    areRenderSizesEquivalent(stable, {
      ...stable,
      offsetY: 525.75,
      scale: stable.scale + 1 / 8192,
    }),
  ).toBe(true);
  expect(areRenderSizesEquivalent(stable, { ...stable, offsetY: 526.25 })).toBe(false);
  expect(hasMaterialRenderSizeChange(stable, { ...stable, offsetY: 526.25 })).toBe(false);
  expect(hasMaterialRenderSizeChange(stable, { ...stable, height: stable.height + 1 })).toBe(true);
});
