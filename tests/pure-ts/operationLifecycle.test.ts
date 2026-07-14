import { afterEach, describe, expect, test } from 'bun:test';

import { useOperationLaunchStore } from '../../src/store/useOperationLaunchStore';
import { createHdrOperationSession, reduceHdrOperationSession } from '../../src/workflows/hdr/hdrOperation';
import {
  createOperationSession,
  type OperationEvent,
  type OperationLaunch,
  reduceOperationSession,
} from '../../src/workflows/operationLifecycle';

const launch: OperationLaunch = {
  kind: 'hdr',
  launchId: 'hdr-launch-1',
  openedAtRevision: 1,
  sourcePaths: ['a.raw', 'b.raw'],
};

afterEach(() => useOperationLaunchStore.setState({ launches: {} }));

describe('operation lifecycle', () => {
  test('moves through prepare, review, run, and completion', () => {
    let session = createOperationSession(launch);
    const events: OperationEvent[] = [
      { type: 'prepare', launchId: launch.launchId },
      { type: 'ready', launchId: launch.launchId },
      { type: 'start', launchId: launch.launchId },
      { type: 'progress', launchId: launch.launchId, progress: 0.4 },
      { type: 'complete', launchId: launch.launchId },
    ];
    for (const event of events) session = reduceOperationSession(session, event);
    expect(session.lifecycle).toBe('completed');
    expect(session.progress).toBe(1);
  });

  test('rejects late events from a closed/reopened launch', () => {
    const closed = reduceOperationSession(createOperationSession(launch), { type: 'close', launchId: launch.launchId });
    const late = reduceOperationSession(closed, { type: 'complete', launchId: 'old-launch' });
    expect(late).toBe(closed);
    expect(reduceOperationSession(closed, { type: 'progress', launchId: launch.launchId, progress: 0.8 })).toBe(closed);
  });

  test('clamps progress and fails with a typed error', () => {
    const running = reduceOperationSession(createOperationSession(launch), {
      type: 'start',
      launchId: launch.launchId,
    });
    const clamped = reduceOperationSession(running, { type: 'progress', launchId: launch.launchId, progress: 4 });
    const failed = reduceOperationSession(clamped, {
      type: 'fail',
      error: 'native unavailable',
      launchId: launch.launchId,
    });
    expect(clamped.progress).toBe(1);
    expect(failed.lifecycle).toBe('failed');
    expect(failed.error).toBe('native unavailable');
  });

  test('HDR adapter preserves launch currentness through its domain reducer', () => {
    const session = createHdrOperationSession(launch);
    const next = reduceHdrOperationSession(session, { type: 'start', launchId: launch.launchId });
    expect(next.launch.kind).toBe('hdr');
    expect(next.lifecycle).toBe('running');
  });

  test('launch registry replaces a kind with a fresh identity and closes conditionally', () => {
    const first = useOperationLaunchStore.getState().launch('hdr', ['a.raw', 'a.raw'], 1);
    const second = useOperationLaunchStore.getState().launch('hdr', ['b.raw'], 2);
    expect(second.launchId).not.toBe(first.launchId);
    expect(useOperationLaunchStore.getState().launches.hdr?.sourcePaths).toEqual(['b.raw']);
    useOperationLaunchStore.getState().close('hdr', first.launchId);
    expect(useOperationLaunchStore.getState().launches.hdr?.launchId).toBe(second.launchId);
    useOperationLaunchStore.getState().close('hdr', second.launchId);
    expect(useOperationLaunchStore.getState().launches.hdr).toBeUndefined();
  });
});
