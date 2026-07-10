import { describe, expect, test } from 'bun:test';
import {
  createViewerSampleRequest,
  isViewerSampleResultCurrent,
  LatestViewerSampleScheduler,
  mapViewerPointToImage,
  resolveViewerSampleTarget,
  type ViewerSampleRequest,
} from '../../../src/utils/viewerSampler';

const request = (x: number, geometryEpoch = 7): ViewerSampleRequest =>
  createViewerSampleRequest({
    imageIdentity: '/fixture/color-patches.tif',
    graphRevision: 'history_3',
    geometryEpoch,
    normalizedImagePoint: { x, y: 0.5 },
    sourceImageSize: { width: 400, height: 200 },
    target: 'edited',
    sampleRadiusImagePx: 1,
    requestedSpace: 'displayEncoded',
  });

describe('viewer sampler contract', () => {
  test('maps transformed viewer coordinates into normalized image coordinates', () => {
    expect(
      mapViewerPointToImage({
        clientPoint: { x: 300, y: 250 },
        displayedImageRect: { x: 100, y: 50, width: 400, height: 200 },
        surfaceRect: { x: 0, y: 0, width: 1200, height: 800, layoutWidth: 600, layoutHeight: 400 },
      }),
    ).toEqual({
      normalizedImagePoint: { x: 0.125, y: 0.375 },
      normalizedViewerX: 0.25,
      normalizedViewerY: 0.3125,
    });
  });

  test('selects the compare pane under the pointer and preserves proof target', () => {
    expect(
      resolveViewerSampleTarget({ compareMode: 'split-wipe', normalizedViewerX: 0.2, softProofEnabled: true }),
    ).toBe('original');
    expect(
      resolveViewerSampleTarget({ compareMode: 'side-by-side', normalizedViewerX: 0.8, softProofEnabled: true }),
    ).toBe('softProof');
    expect(resolveViewerSampleTarget({ compareMode: 'off', normalizedViewerX: 0.2, softProofEnabled: false })).toBe(
      'edited',
    );
    expect(
      resolveViewerSampleTarget({
        compareMode: 'split-wipe',
        compareDividerPosition: 0.7,
        compareOrientation: 'horizontal',
        normalizedViewerX: 0.9,
        normalizedViewerY: 0.6,
        softProofEnabled: false,
      }),
    ).toBe('original');
  });

  test('binds result acceptance to image, graph, geometry, target, radius, and point identity', () => {
    const current = request(0.25);
    const result = {
      status: 'available' as const,
      requestIdentity: current.requestIdentity,
      imagePointPx: { x: 100, y: 100 },
      rgb: [0.1, 0.2, 0.3] as [number, number, number],
      luma: 0.18596,
      clippedChannels: [],
      spaceLabel: 'Display encoded sRGB',
    };

    expect(isViewerSampleResultCurrent(result, current)).toBe(true);
    expect(isViewerSampleResultCurrent(result, request(0.25, 8))).toBe(false);
    expect(isViewerSampleResultCurrent(result, request(0.26))).toBe(false);
  });

  test('coalesces movement to the latest request while one native sample is in flight', async () => {
    const executed: ViewerSampleRequest[] = [];
    const releases: Array<() => void> = [];
    const scheduler = new LatestViewerSampleScheduler((next) => {
      executed.push(next);
      return new Promise<void>((resolve) => releases.push(resolve));
    }, 0);

    scheduler.schedule(request(0.1));
    scheduler.schedule(request(0.2));
    scheduler.schedule(request(0.3));
    expect(executed.map((item) => item.normalizedImagePoint.x)).toEqual([0.1]);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(executed.map((item) => item.normalizedImagePoint.x)).toEqual([0.1, 0.3]);
    releases.shift()?.();
    scheduler.dispose();
  });
});
