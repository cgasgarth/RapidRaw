import { performance } from 'node:perf_hooks';
import { ThumbnailDemandScheduler } from '../../src/thumbnails/ThumbnailDemandScheduler.ts';

for (const librarySize of [10_000, 50_000]) {
  const paths = Array.from({ length: librarySize }, (_, index) => `/benchmark/image-${index}.raw`);
  const frames: Array<() => void> = [];
  const batches: string[][] = [];
  let now = 0;
  const scheduler = new ThumbnailDemandScheduler({
    dispatch: (request) => batches.push(request.requests.map(({ path }) => path)),
    now: () => now,
    requestFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => {},
  });
  scheduler.beginGeneration('benchmark');

  const started = performance.now();
  for (let viewport = 0; viewport < 100; viewport += 1) {
    const start = Math.min(librarySize - 48, viewport * 30);
    scheduler.updateViewport({
      generation: scheduler.currentGeneration,
      visiblePaths: paths.slice(start, start + 24),
      overscanPaths: paths.slice(start + 24, start + 36),
      lookaheadPaths: paths.slice(start + 36, start + 48),
      direction: 'forward',
      velocityPxPerMs: 4,
    });
  }
  now = 16;
  frames.splice(0).forEach((callback) => callback());
  for (const path of batches.flat()) scheduler.markResident(path);
  const elapsedMs = performance.now() - started;
  const metrics = scheduler.getMetrics();
  scheduler.dispose();
  console.log(
    JSON.stringify({
      librarySize,
      scenario: '100-viewport-fast-fling',
      schedulingCpuMs: Number(elapsedMs.toFixed(3)),
      dispatchedPaths: batches.flat().length,
      staleQueuedRemoved: metrics.staleQueuedRemoved,
      queuePeak: metrics.queuePeak,
      inFlightPeak: metrics.inFlightPeak,
      frameEligibleMs: 16,
      legacyTimerFloorMs: 200,
    }),
  );
}
