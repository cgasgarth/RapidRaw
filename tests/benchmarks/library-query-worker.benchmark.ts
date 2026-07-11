import { expect, test } from 'bun:test';

import { RawStatus, SortDirection } from '../../src/components/ui/AppProperties';
import type { LibrarySearchProjection } from '../../src/library/LibrarySearchProjection';
import type { SerializedCompiledLibraryQuery } from '../../src/library/libraryQuery';
import type { LibraryQueryWorkerCommand, LibraryQueryWorkerResult } from '../../src/library/libraryQueryWorkerProtocol';

const ITEM_COUNT = 50_000;

test('50k query stays off the caller thread', async () => {
  const worker = new Worker(new URL('../../src/workers/libraryQuery.worker.ts', import.meta.url), {
    type: 'module',
  });
  const projections = Array.from(
    { length: ITEM_COUNT },
    (_, ordinal): LibrarySearchProjection => ({
      aperture: (ordinal % 20) / 2,
      baseName: `image-${ordinal}`,
      cameraSearchText: `camera ${ordinal % 12}`,
      colorLabel: ordinal % 5 === 0 ? 'red' : null,
      dateTaken: `2024:01:${String((ordinal % 28) + 1).padStart(2, '0')}`,
      entityRevision: ordinal + 1,
      extension: ordinal % 3 === 0 ? 'raf' : 'jpg',
      fileName: `image-${String(ITEM_COUNT - ordinal).padStart(6, '0')}.jpg`,
      focalLengthMm: 20 + (ordinal % 180),
      isEdited: ordinal % 4 === 0,
      isNonRaw: ordinal % 3 !== 0,
      isRaw: ordinal % 3 === 0,
      iso: 100 * 2 ** (ordinal % 6),
      lensSearchText: `lens ${ordinal % 8}`,
      modified: ITEM_COUNT - ordinal,
      normalizedFileName: `image-${String(ITEM_COUNT - ordinal).padStart(6, '0')}.jpg`,
      normalizedUserTags: [`tag-${ordinal % 20}`],
      parentDirectory: '/benchmark',
      path: `/benchmark/image-${ordinal}.jpg`,
      physicalPath: `/benchmark/image-${ordinal}.jpg`,
      rawPairKey: `/benchmark/image-${ordinal}`,
      rating: ordinal % 6,
      shutterSeconds: 1 / (30 + (ordinal % 500)),
      stableOrdinal: ordinal,
    }),
  );
  const criteria: SerializedCompiledLibraryQuery = {
    filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.All },
    searchCriteria: { mode: 'OR', tags: [], text: '' },
    sortCriteria: { key: 'name', order: SortDirection.Ascending },
  };
  const receive = (predicate: (result: LibraryQueryWorkerResult) => boolean) =>
    new Promise<LibraryQueryWorkerResult>((resolve) => {
      worker.onmessage = (event: MessageEvent<LibraryQueryWorkerResult>) => {
        if (predicate(event.data)) resolve(event.data);
      };
    });

  const ready = receive((result) => result.type === 'ready');
  worker.postMessage({ type: 'hydrate', indexRevision: 1, projections } satisfies LibraryQueryWorkerCommand);
  await ready;

  let largestTimerGapMs = 0;
  let previousTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    largestTimerGapMs = Math.max(largestTimerGapMs, now - previousTick);
    previousTick = now;
  }, 2);
  const resultPromise = receive((result) => result.type === 'result');
  const postStarted = performance.now();
  worker.postMessage({
    type: 'query',
    requestId: 1,
    indexRevision: 1,
    queryRevision: 1,
    criteria,
  } satisfies LibraryQueryWorkerCommand);
  const postDurationMs = performance.now() - postStarted;
  const result = await resultPromise;
  clearInterval(timer);
  worker.terminate();

  expect(result).toMatchObject({ type: 'result', matchedCount: ITEM_COUNT });
  expect(postDurationMs).toBeLessThan(16);
  console.info(
    JSON.stringify({
      itemCount: ITEM_COUNT,
      postDurationMs,
      largestTimerGapMs,
      workerDurationMs: result.type === 'result' ? result.durationMs : null,
    }),
  );
}, 15_000);
