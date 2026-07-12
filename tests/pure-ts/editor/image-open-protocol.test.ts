import { describe, expect, mock, test } from 'bun:test';

const calls: Array<{ args: unknown; command: string }> = [];
const invoke = mock(async (command: string, args: unknown) => {
  calls.push({ args, command });
  if (command === 'begin_image_open') {
    return {
      decodeReadyMillis: 20,
      decoded: {
        exif: {},
        height: 80,
        is_raw: false,
        metadata: { adjustments: null },
        width: 100,
      },
      imageId: '/library/b.jpg',
      joinedPrefetch: true,
      metadataFingerprint: 'a'.repeat(64),
      metadataReadyMillis: 2,
      sessionId: { imageSession: 4, selectionGeneration: 4 },
    };
  }
  if (command === 'schedule_image_prefetch') {
    return {
      duplicatePrefetchDrops: 0,
      foregroundOpens: 1,
      metadataReads: 1,
      peakPrefetchInFlight: 2,
      prefetchCancelled: 0,
      prefetchCompleted: 1,
      prefetchPromotions: 1,
      prefetchRequested: 3,
      prefetchStarted: 2,
      stalePhaseDrops: 0,
    };
  }
  throw new Error(`Unexpected command: ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));

const { beginImageOpenWithSchema, scheduleImagePrefetchWithSchema } = await import(
  '../../../src/utils/imageOpenInvokes'
);
const { imageOpenUpdateSchema } = await import('../../../src/schemas/imageLoaderSchemas');
const { isImageOpenUpdateCurrent } = await import('../../../src/utils/imageOpenPhaseCurrentness');

describe('revisioned image-open protocol', () => {
  test('one foreground action uses one staged command and joins prefetched work', async () => {
    calls.length = 0;
    const result = await beginImageOpenWithSchema({
      expectedCatalogRevision: 8,
      expectedEntityRevision: 3,
      imageId: '/library/b.jpg',
      path: '/library/b.jpg',
      sessionId: { imageSession: 4, selectionGeneration: 4 },
    });
    expect(result.joinedPrefetch).toBe(true);
    expect(calls.map(({ command }) => command)).toEqual(['begin_image_open']);
    expect(calls.some(({ command }) => ['is_image_cached', 'load_metadata', 'load_image'].includes(command))).toBe(
      false,
    );
  });

  test('metadata and decode share one identity while stale A phases cannot publish into B', () => {
    const metadata = imageOpenUpdateSchema.parse({
      imageId: 'b',
      metadata: { adjustments: null },
      metadataFingerprint: 'b'.repeat(64),
      path: '/b.raw',
      phase: 'metadataReady',
      sessionId: { imageSession: 2, selectionGeneration: 2 },
    });
    const staleDecode = imageOpenUpdateSchema.parse({
      height: 80,
      imageId: 'a',
      isRaw: true,
      path: '/a.raw',
      phase: 'decodeReady',
      sessionId: { imageSession: 1, selectionGeneration: 1 },
      width: 100,
    });
    expect(isImageOpenUpdateCurrent(metadata, { generation: 2, path: '/b.raw' })).toBe(true);
    expect(isImageOpenUpdateCurrent(staleDecode, { generation: 2, path: '/b.raw' })).toBe(false);
  });

  test('prefetch request remains bounded at the typed IPC boundary', async () => {
    calls.length = 0;
    const report = await scheduleImagePrefetchWithSchema({
      candidates: ['/next.raw', '/next-2.raw', '/previous.raw'],
      collectionGeneration: 5,
      memoryPressure: false,
      workloadBusy: false,
    });
    expect(report.peakPrefetchInFlight).toBe(2);
    expect(calls.map(({ command }) => command)).toEqual(['schedule_image_prefetch']);
  });
});
