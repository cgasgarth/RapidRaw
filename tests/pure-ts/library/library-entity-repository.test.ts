import { describe, expect, test } from 'bun:test';
import { LibraryEntityRepository } from '../../../src/library/LibraryEntityRepository';

const image = (path: string, rating = 0) => ({
  path,
  rating,
  modified: 1,
  is_edited: false,
  is_virtual_copy: path.includes('?vc='),
  tags: null,
  exif: null,
});

describe('LibraryEntityRepository', () => {
  test('isolates snapshots and notifications by path', () => {
    const repository = new LibraryEntityRepository();
    repository.replaceAll([image('/a.raw'), image('/b.raw')]);
    const beforeA = repository.get('/a.raw');
    const beforeB = repository.get('/b.raw');
    let notificationsA = 0;
    let notificationsB = 0;
    repository.subscribe('/a.raw', () => notificationsA++);
    repository.subscribe('/b.raw', () => notificationsB++);

    repository.patchMany([
      { path: '/a.raw', changes: { rating: 4 } },
      { path: '/a.raw', changes: { is_edited: true } },
    ]);

    expect(repository.get('/a.raw')).not.toBe(beforeA);
    expect(repository.get('/a.raw')?.entityRevision).toBe((beforeA?.entityRevision ?? 0) + 1);
    expect(repository.get('/b.raw')).toBe(beforeB);
    expect([notificationsA, notificationsB]).toEqual([1, 0]);
  });

  test('identical patches are no-ops and ratings are clamped', () => {
    const repository = new LibraryEntityRepository();
    repository.replaceAll([image('/a.raw', 2)]);
    const before = repository.get('/a.raw');
    let deltas = 0;
    repository.subscribeDeltas(() => deltas++);
    repository.patchMany([
      { path: '/a.raw', changes: { rating: 2 } },
      { path: '/missing', changes: { rating: 5 } },
    ]);
    expect(repository.get('/a.raw')).toBe(before);
    expect(deltas).toBe(0);
    repository.patchMany([{ path: '/a.raw', changes: { rating: 99 } }]);
    expect(repository.get('/a.raw')?.rating).toBe(5);
  });

  test('remove and rename preserve virtual-copy identity', () => {
    const repository = new LibraryEntityRepository();
    repository.replaceAll([image('/a.raw'), image('/a.raw?vc=1', 3)]);
    const deltas: Array<{ removedPaths: readonly string[]; renamed: readonly unknown[] }> = [];
    repository.subscribeDeltas((delta) => deltas.push(delta));
    repository.rename('/a.raw?vc=1', image('/a.raw?vc=2', 3));
    expect(repository.get('/a.raw')).toBeDefined();
    expect(repository.get('/a.raw?vc=1')).toBeUndefined();
    expect(repository.get('/a.raw?vc=2')?.is_virtual_copy).toBe(true);
    expect(deltas[0]?.removedPaths).toEqual(['/a.raw?vc=1']);
    expect(deltas[0]?.renamed).toEqual([{ oldPath: '/a.raw?vc=1', newPath: '/a.raw?vc=2' }]);
  });

  test('50k metadata patch visits and allocates only changed snapshots', () => {
    const repository = new LibraryEntityRepository();
    const images = Array.from({ length: 50_000 }, (_, index) => image(`/library/${index}.raw`));
    repository.replaceAll(images);
    const untouched = repository.get('/library/49999.raw');
    const changed = Array.from({ length: 1_000 }, (_, index) => ({
      path: `/library/${index}.raw`,
      changes: { rating: index % 6, is_edited: true },
    }));
    let upserted = 0;
    repository.subscribeDeltas((delta) => (upserted += delta.upserted.length));
    const started = performance.now();
    repository.patchMany(changed);
    const elapsedMs = performance.now() - started;
    expect(repository.get('/library/49999.raw')).toBe(untouched);
    expect(upserted).toBe(1_000);
    expect(elapsedMs).toBeLessThan(250);
  });
});
