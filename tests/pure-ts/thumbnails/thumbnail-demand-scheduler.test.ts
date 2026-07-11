import { describe, expect, test } from 'bun:test';
import {
  type ThumbnailBackendRequest,
  ThumbnailDemandScheduler,
} from '../../../src/thumbnails/ThumbnailDemandScheduler.ts';

function createHarness(policy: Record<string, number> = {}) {
  let now = 0;
  let nextHandle = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; at: number }>();
  const requests: ThumbnailBackendRequest[] = [];
  const resident = new Set<string>();
  const scheduler = new ThumbnailDemandScheduler({
    dispatch: (request) => requests.push(request),
    isResident: (path) => resident.has(path),
    now: () => now,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimer: (callback, delay) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, at: now + delay });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
    policy,
  });
  const viewport = (visiblePaths: string[], overscanPaths: string[] = [], lookaheadPaths: string[] = []) =>
    scheduler.updateViewport({
      generation: scheduler.currentGeneration,
      visiblePaths,
      overscanPaths,
      lookaheadPaths,
      direction: 'forward',
      velocityPxPerMs: 1,
    });
  const runFrame = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback());
  };
  const advance = (ms: number) => {
    now += ms;
    const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
    due.forEach(([handle, timer]) => {
      timers.delete(handle);
      timer.callback();
    });
  };
  return {
    scheduler,
    requests,
    resident,
    frames,
    timers,
    viewport,
    runFrame,
    advance,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe('ThumbnailDemandScheduler', () => {
  test('dispatches visible, overscan, then lookahead in deterministic order on one frame', () => {
    const harness = createHarness({ maxBatchSize: 8, maxInFlight: 8 });
    harness.viewport(['visible-b', 'visible-a'], ['over-near', 'over-far'], ['ahead']);
    harness.viewport(['visible-b', 'visible-a'], ['over-near', 'over-far'], ['ahead']);
    expect(harness.frames.size).toBe(1);
    harness.runFrame();
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.requests.map(({ path }) => path)).toEqual([
      'visible-b',
      'visible-a',
      'over-near',
      'over-far',
      'ahead',
    ]);
    expect(harness.requests[0]?.replacePending).toBe(true);
  });

  test('a fast fling drops traversed queued paths before dispatch', () => {
    const harness = createHarness();
    harness.viewport(['old-visible'], ['old-over']);
    harness.viewport(['new-visible'], ['new-over']);
    harness.runFrame();
    expect(harness.requests[0]?.requests.map(({ path }) => path)).toEqual(['new-visible', 'new-over']);
    expect(harness.scheduler.getMetrics().staleQueuedRemoved).toBe(2);
  });

  test('re-submits still-demanded paths when replacing uncertain backend pending work', () => {
    const harness = createHarness();
    harness.viewport(['visible'], ['overscan']);
    harness.runFrame();
    harness.viewport(['visible'], ['next-overscan']);
    harness.runFrame();
    expect(harness.requests[1]?.replacePending).toBe(true);
    expect(harness.requests[1]?.requests.map(({ path }) => path)).toEqual(['visible', 'next-overscan']);
  });

  test('bounds batches and in-flight work, then continues after completions', () => {
    const harness = createHarness({ maxBatchSize: 2, maxInFlight: 3, continuationDelayMs: 5 });
    harness.viewport(['a', 'b', 'c', 'd']);
    harness.runFrame();
    expect(harness.requests[0]?.requests).toHaveLength(2);
    harness.advance(5);
    expect(harness.requests[1]?.requests).toHaveLength(1);
    expect(harness.scheduler.getMetrics().inFlightPeak).toBe(3);
    harness.scheduler.markResident('a');
    harness.runFrame();
    expect(harness.requests[2]?.requests.map(({ path }) => path)).toEqual(['d']);
  });

  test('warm-cache and generated paths are resident and never requeued', () => {
    const harness = createHarness();
    harness.resident.add('warm');
    harness.viewport(['warm', 'cold']);
    harness.runFrame();
    expect(harness.requests[0]?.requests.map(({ path }) => path)).toEqual(['cold']);
    harness.scheduler.markResident('cold');
    harness.viewport(['cold', 'warm']);
    harness.runFrame();
    expect(harness.requests).toHaveLength(1);
  });

  test('invalidates demanded paths immediately and defers off-screen paths', () => {
    const harness = createHarness();
    harness.viewport(['visible']);
    harness.runFrame();
    harness.scheduler.markResident('visible');
    harness.scheduler.invalidate(['visible', 'offscreen']);
    harness.runFrame();
    expect(harness.requests.at(-1)?.requests.map(({ path }) => path)).toEqual(['visible']);
  });

  test('rejects stale completions and cancels old retries on generation change', () => {
    const harness = createHarness({ retryBaseMs: 10 });
    harness.viewport(['retry']);
    harness.runFrame();
    harness.scheduler.markFailed('retry');
    const oldGeneration = harness.scheduler.currentGeneration;
    harness.scheduler.beginGeneration('folder changed');
    harness.advance(100);
    expect(harness.scheduler.markResident('retry', oldGeneration)).toBe(false);
    expect(harness.requests.at(-1)).toEqual({
      generation: oldGeneration + 1,
      replacePending: true,
      requests: [],
    });
  });

  test('dispose cancels callbacks and sends an empty newer generation', () => {
    const harness = createHarness();
    harness.viewport(['a']);
    harness.scheduler.dispose();
    expect(harness.frames.size).toBe(0);
    expect(harness.timers.size).toBe(0);
    expect(harness.requests.at(-1)?.requests).toEqual([]);
  });

  test('records frame dispatch and visible-resident latency with bounded samples', () => {
    const harness = createHarness({ metricsSampleLimit: 2 });
    harness.setNow(5);
    harness.viewport(['a']);
    harness.setNow(16);
    harness.runFrame();
    harness.setNow(40);
    harness.scheduler.markResident('a');
    const metrics = harness.scheduler.getMetrics();
    expect(metrics.visibleDispatchMs).toEqual([11]);
    expect(metrics.visibleResidentMs).toEqual([35]);
    expect(metrics.ipcBatchCount).toBe(1);
    expect(metrics.averageBatchSize).toBe(1);
  });
});
