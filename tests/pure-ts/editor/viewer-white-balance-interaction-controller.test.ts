import { describe, expect, test } from 'bun:test';

import {
  isViewerWhiteBalanceSampleCurrent,
  resolveViewerWhiteBalanceInteraction,
} from '../../../src/components/panel/editor/viewerWhiteBalanceInteractionController';

const context = {
  cropSize: { height: 400, width: 800 },
  geometryEpoch: 7,
  previewIdentity: 'preview:42',
  sourceIdentity: 'image:alaska.RAF',
} as const;

describe('viewer white-balance interaction controller', () => {
  test('creates a session identity for a geometry-mapped crop point', () => {
    const result = resolveViewerWhiteBalanceInteraction(context, { x: 120.5, y: 80 }, 3);

    expect(result).toEqual({
      imagePoint: { x: 120.5, y: 80 },
      identity: {
        geometryEpoch: 7,
        previewIdentity: 'preview:42',
        sequence: 3,
        sourceIdentity: 'image:alaska.RAF',
      },
    });
  });

  test('rejects points outside the crop and malformed session inputs', () => {
    expect(resolveViewerWhiteBalanceInteraction(context, { x: -1, y: 10 }, 1)).toBeNull();
    expect(resolveViewerWhiteBalanceInteraction(context, { x: 800, y: 401 }, 1)).toBeNull();
    expect(resolveViewerWhiteBalanceInteraction({ ...context, previewIdentity: '' }, { x: 1, y: 1 }, 1)).toBeNull();
    expect(resolveViewerWhiteBalanceInteraction(context, { x: 1, y: 1 }, 0)).toBeNull();
  });

  test('accepts only the latest active source, preview, and geometry session', () => {
    const current = resolveViewerWhiteBalanceInteraction(context, { x: 4, y: 5 }, 2)?.identity;
    const latest = resolveViewerWhiteBalanceInteraction(context, { x: 10, y: 11 }, 3)?.identity;
    expect(current).toBeDefined();
    expect(latest).toBeDefined();
    expect(isViewerWhiteBalanceSampleCurrent(latest!, latest!, true)).toBe(true);
    expect(isViewerWhiteBalanceSampleCurrent(current!, latest!, true)).toBe(false);
    expect(isViewerWhiteBalanceSampleCurrent(latest!, { ...latest!, geometryEpoch: 8 }, true)).toBe(false);
    expect(isViewerWhiteBalanceSampleCurrent(latest!, { ...latest!, sourceIdentity: 'image:other.RAF' }, true)).toBe(
      false,
    );
    expect(isViewerWhiteBalanceSampleCurrent(latest!, latest!, false)).toBe(false);
  });
});
