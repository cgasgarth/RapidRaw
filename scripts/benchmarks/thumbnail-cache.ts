import { performance } from 'node:perf_hooks';
import { ThumbnailCache } from '../../src/thumbnails/ThumbnailCache';

const SIZE = 50_000;
const BATCH = 1_000;
const seeded = Object.fromEntries(Array.from({ length: SIZE }, (_, i) => [`path-${i}`, `data:image/jpeg;base64,${i}`]));
const cache = new ThumbnailCache();
cache.setMany(Object.entries(seeded).map(([path, url]) => ({ generation: 1, path, url })));

const measure = (run: () => void): number => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

const batch = Array.from({ length: BATCH }, (_, i) => ({ generation: 2, path: `new-${i}`, url: `data:${i}` }));
const keyedBatchMs = measure(() => cache.setMany(batch));
const legacyBatchMs = measure(() => {
  Object.assign({}, seeded, Object.fromEntries(batch.map((x) => [x.path, x.url])));
});
const keyedSingleMs = measure(() => cache.setMany([{ generation: 3, path: 'path-1', url: 'changed' }]));
const legacySingleMs = measure(() => {
  Object.assign({}, seeded, { 'path-1': 'changed' });
});
const invalidated = Array.from({ length: 100 }, (_, i) => `path-${i * 10}`);
const keyedDeleteMs = measure(() => cache.deleteMany(invalidated));
const invalidatedSet = new Set(invalidated);
const legacyDeleteMs = measure(() => {
  Object.fromEntries(Object.entries(seeded).filter(([path]) => !invalidatedSet.has(path)));
});

console.table({
  batch1000: { keyedMs: keyedBatchMs, legacyMs: legacyBatchMs, existingEntriesVisited: BATCH },
  delete100: { keyedMs: keyedDeleteMs, legacyMs: legacyDeleteMs, existingEntriesVisited: 100 },
  updateOne: { keyedMs: keyedSingleMs, legacyMs: legacySingleMs, existingEntriesVisited: 1 },
});
