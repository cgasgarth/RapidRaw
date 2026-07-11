import { describe, expect, test } from 'bun:test';

import { EditedStatus, type ImageFile, RawStatus, SortDirection } from '../../../src/components/ui/AppProperties';
import { LibraryQueryController, type LibraryQueryWorkerLike } from '../../../src/library/LibraryQueryController';
import { queryLibraryProjections, type SerializedCompiledLibraryQuery } from '../../../src/library/libraryQuery';
import type {
  LibraryQueryWorkerCommand,
  LibraryQueryWorkerResult,
} from '../../../src/library/libraryQueryWorkerProtocol';
import { buildLibrarySearchProjection, normalizeSupportedTypes } from '../../../src/library/LibrarySearchProjection';
import { createLibraryQueryRuntime } from '../../../src/workers/libraryQueryRuntime';

const files: ImageFile[] = [
  {
    path: '/photos/camera.jpg',
    modified: 20,
    rating: 0,
    is_edited: false,
    is_virtual_copy: false,
    tags: ['user:travel', 'color:red'],
    exif: {
      Make: 'Fuji',
      Model: 'X-T5',
      LensModel: '23mm',
      PhotographicSensitivity: '400',
      FNumber: 'f/2.8',
      ExposureTime: '1/125',
      FocalLength: '23 mm',
      DateTimeOriginal: '2024:02:01',
    },
  },
  {
    path: '/photos/camera.raf',
    modified: 10,
    rating: 0,
    is_edited: true,
    is_virtual_copy: false,
    tags: ['user:travel'],
    exif: { Make: 'Fuji', Model: 'X-T5', PhotographicSensitivity: '800', DateTimeOriginal: '2024:01:01' },
  },
  {
    path: '/photos/camera.raf?vc=1',
    modified: 11,
    rating: 0,
    is_edited: true,
    is_virtual_copy: true,
    tags: ['user:select', 'color:blue'],
    exif: { Make: 'Fuji', Model: 'X-T5', PhotographicSensitivity: '200', DateTimeOriginal: '2024:01:01' },
  },
  {
    path: '/photos/duplicate.jpg',
    modified: 30,
    rating: 0,
    is_edited: false,
    is_virtual_copy: false,
    tags: null,
    exif: null,
  },
];
const ratings = { '/photos/camera.jpg': 2, '/photos/camera.raf': 5, '/photos/camera.raf?vc=1': 4 };
const projections = files.map((file, stableOrdinal) =>
  buildLibrarySearchProjection(file, {
    entityRevision: stableOrdinal + 1,
    rating: ratings[file.path] ?? 0,
    stableOrdinal,
    supportedTypes: normalizeSupportedTypes({ raw: ['raf'], nonRaw: ['jpg'] }),
  }),
);
const firstProjection = projections[0];
if (!firstProjection) throw new Error('Expected a projection fixture');

function criteria(overrides: {
  filter?: Partial<SerializedCompiledLibraryQuery['filterCriteria']>;
  search?: Partial<SerializedCompiledLibraryQuery['searchCriteria']>;
  sort?: Partial<SerializedCompiledLibraryQuery['sortCriteria']>;
} = {}): SerializedCompiledLibraryQuery {
  return {
    filterCriteria: { colors: [], editedStatus: EditedStatus.All, rating: 0, rawStatus: RawStatus.All, ...overrides.filter },
    searchCriteria: { mode: 'OR', tags: [], text: '', ...overrides.search },
    sortCriteria: { key: 'name', order: SortDirection.Ascending, ...overrides.sort },
  };
}

describe('library query reference', () => {
  test('preserves RAW-pair, virtual-copy, search, filter, and sort semantics', () => {
    expect(queryLibraryProjections(projections, criteria({ filter: { rawStatus: RawStatus.RawOverNonRaw } }))).toEqual([
      '/photos/camera.raf',
      '/photos/camera.raf?vc=1',
      '/photos/duplicate.jpg',
    ]);
    expect(queryLibraryProjections(projections, criteria({ search: { text: 'travel' } }))).toEqual([
      '/photos/camera.jpg',
      '/photos/camera.raf',
    ]);
    expect(
      queryLibraryProjections(
        projections,
        criteria({ search: { tags: ['iso>=400'] } }),
      ),
    ).toEqual(['/photos/camera.jpg', '/photos/camera.raf']);
    expect(
      queryLibraryProjections(projections, criteria({ sort: { key: 'rating', order: SortDirection.Descending } })),
    ).toEqual(['/photos/camera.raf', '/photos/camera.raf?vc=1', '/photos/camera.jpg', '/photos/duplicate.jpg']);
  });
});

describe('library query worker runtime', () => {
  test('enforces revisions and coalesces queued queries', async () => {
    const results: LibraryQueryWorkerResult[] = [];
    const runtime = createLibraryQueryRuntime((result) => results.push(result));
    runtime.handle({ type: 'hydrate', indexRevision: 1, projections });
    runtime.handle({ type: 'upsert', indexRevision: 3, projections: [firstProjection] });
    runtime.handle({
      type: 'query',
      requestId: 1,
      queryRevision: 1,
      indexRevision: 1,
      criteria: criteria({ search: { text: 'cam' } }),
    });
    runtime.handle({
      type: 'query',
      requestId: 2,
      queryRevision: 2,
      indexRevision: 1,
      criteria: criteria({ search: { text: 'duplicate' } }),
    });
    await Bun.sleep(5);
    expect(results.some((result) => result.type === 'error' && result.code === 'INDEX_RESYNC_REQUIRED')).toBeTrue();
    const queryResults = results.filter((result) => result.type === 'result');
    expect(queryResults).toHaveLength(1);
    expect(queryResults[0]).toMatchObject({
      requestId: 2,
      queryRevision: 2,
      indexRevision: 1,
      orderedPaths: ['/photos/duplicate.jpg'],
    });
  });

  test('applies incremental upsert and remove revisions', async () => {
    const results: LibraryQueryWorkerResult[] = [];
    const runtime = createLibraryQueryRuntime((result) => results.push(result));
    runtime.handle({ type: 'hydrate', indexRevision: 4, projections });
    runtime.handle({ type: 'remove', indexRevision: 5, paths: ['/photos/duplicate.jpg'] });
    runtime.handle({ type: 'upsert', indexRevision: 6, projections: [{ ...firstProjection, rating: 5 }] });
    runtime.handle({
      type: 'query',
      requestId: 7,
      queryRevision: 8,
      indexRevision: 6,
      criteria: criteria({ filter: { rating: 5 } }),
    });
    await Bun.sleep(5);
    expect(results.at(-1)).toMatchObject({
      type: 'result',
      requestId: 7,
      indexRevision: 6,
      queryRevision: 8,
      orderedPaths: ['/photos/camera.jpg', '/photos/camera.raf'],
    });
  });
});

class RuntimeWorker implements LibraryQueryWorkerLike {
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent<LibraryQueryWorkerResult>) => void) | null = null;
  readonly commands: LibraryQueryWorkerCommand[] = [];
  private runtime = createLibraryQueryRuntime((result) =>
    this.onmessage?.({ data: result } as MessageEvent<LibraryQueryWorkerResult>),
  );
  postMessage(command: LibraryQueryWorkerCommand) {
    this.commands.push(command);
    this.runtime.handle(command);
  }
  terminate() {}
}

test('controller rejects stale results and keeps the committed result while querying', async () => {
  const worker = new RuntimeWorker();
  const controller = new LibraryQueryController(() => worker);
  controller.syncIndex(projections);
  controller.query(criteria({ search: { text: 'cam' } }));
  controller.query(criteria({ search: { text: 'duplicate' } }));
  expect(controller.getSnapshot()).toMatchObject({ status: 'querying', orderedPaths: [] });
  await Bun.sleep(5);
  expect(controller.getSnapshot()).toMatchObject({
    status: 'ready',
    committedQueryRevision: 2,
    orderedPaths: ['/photos/duplicate.jpg'],
  });
  controller.query(criteria({ search: { text: 'cam' } }));
  expect(controller.getSnapshot()).toMatchObject({ status: 'querying', orderedPaths: ['/photos/duplicate.jpg'] });
});

test('controller falls back when Worker is unavailable', async () => {
  const controller = new LibraryQueryController(() => null);
  controller.syncIndex(projections);
  controller.query(criteria({ search: { text: 'duplicate' } }));
  await Bun.sleep(5);
  expect(controller.getSnapshot()).toMatchObject({ status: 'ready', orderedPaths: ['/photos/duplicate.jpg'] });
});

test('controller recomputes the pending query after a worker failure', async () => {
  const worker = new RuntimeWorker();
  const controller = new LibraryQueryController(() => worker);
  controller.syncIndex(projections);
  controller.query(criteria({ search: { text: 'duplicate' } }));
  worker.onerror?.(new ErrorEvent('error'));
  await Bun.sleep(5);
  expect(controller.getSnapshot()).toMatchObject({ status: 'ready', orderedPaths: ['/photos/duplicate.jpg'] });
});
