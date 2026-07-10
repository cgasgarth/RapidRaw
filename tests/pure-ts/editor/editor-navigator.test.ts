import { describe, expect, test } from 'bun:test';
import { getNavigatorPanTransform, getNavigatorViewportRect } from '../../../src/utils/editorNavigator';
import type { ViewportSnapshot } from '../../../src/utils/editorViewportBounds';

const snapshot: ViewportSnapshot = {
  containerHeight: 600,
  containerWidth: 800,
  renderSize: { height: 600, offsetX: 0, offsetY: 0, scale: 0.2, width: 800 },
};

describe('editor Navigator geometry', () => {
  test('covers the complete image at Fit', () => {
    expect(getNavigatorViewportRect(snapshot, { positionX: 0, positionY: 0, scale: 1 })).toEqual({
      height: 1,
      width: 1,
      x: 0,
      y: 0,
    });
  });

  test('tracks the canonical transformed viewport at high zoom', () => {
    expect(getNavigatorViewportRect(snapshot, { positionX: -400, positionY: -300, scale: 2 })).toEqual({
      height: 0.5,
      width: 0.5,
      x: 0.25,
      y: 0.25,
    });
  });

  test('clamps panorama and portrait visibility to image bounds', () => {
    const panorama = {
      containerHeight: 600,
      containerWidth: 800,
      renderSize: { height: 200, offsetX: 0, offsetY: 200, scale: 0.2, width: 800 },
    };
    expect(getNavigatorViewportRect(panorama, { positionX: -400, positionY: -300, scale: 2 })).toEqual({
      height: 1,
      width: 0.5,
      x: 0.25,
      y: 0,
    });
  });

  test('recenters the viewer on the Navigator image point without changing scale', () => {
    expect(
      getNavigatorPanTransform({
        imagePoint: { x: 0.75, y: 0.25 },
        snapshot,
        transform: { positionX: 0, positionY: 0, scale: 2 },
      }),
    ).toEqual({ positionX: -800, positionY: 0, scale: 2 });
  });
});
