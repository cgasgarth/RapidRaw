import { describe, expect, test } from 'bun:test';

import type { Adjustments } from '../../../src/utils/adjustments';
import { OriginalPreviewEffectRunner } from '../../../src/utils/originalPreviewEffectRunner';
import {
  fingerprintPreviewGraphRevision,
  PreviewCoordinator,
  type PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
};

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => {
  const values = {
    adjustmentRevision: 1,
    backend: 'cpu' as const,
    displayGeneration: 1,
    geometryRevision: 1,
    imageSessionId: 1,
    maskRevision: 1,
    patchRevision: 1,
    proofRevision: 1,
    roiFingerprint: '[0,0,1,1]',
    sourceImagePath: '/fixtures/a.raw',
    sourceRevision: 1,
    targetHeight: 1000,
    targetWidth: 1000,
    viewportRevision: 1,
    ...overrides,
  };
  return {
    ...values,
    graphRevision:
      overrides.graphRevision ??
      fingerprintPreviewGraphRevision({
        adjustmentRevision: values.adjustmentRevision,
        geometryRevision: values.geometryRevision,
        imageSessionId: values.imageSessionId,
        maskRevision: values.maskRevision,
        patchRevision: values.patchRevision,
        proofRevision: values.proofRevision,
        proposalFingerprint: 'committed',
      }),
  };
};

const request = (identity: PreviewSessionIdentity) => ({
  expectedImagePath: identity.sourceImagePath,
  jsAdjustments: { exposure: identity.adjustmentRevision } as Adjustments,
  targetResolution: identity.targetWidth,
  viewerSampleGraphRevision: identity.graphRevision,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('original preview effect runner', () => {
  test('fails before scheduling when request and typed session identity diverge', () => {
    const coordinator = new PreviewCoordinator();
    const runner = new OriginalPreviewEffectRunner({ dispatch: (event) => coordinator.dispatch(event) });
    const identity = session();

    expect(() => runner.request(identity, { ...request(identity), expectedImagePath: '/fixtures/b.raw' })).toThrow(
      'does not match its typed session identity',
    );
    expect(() => runner.request(identity, { ...request(identity), viewerSampleGraphRevision: 'stale-graph' })).toThrow(
      'does not match its typed session identity',
    );
    expect(coordinator.snapshot().original.status).toBe('idle');
  });

  test('rejects first-A completion after A to B to successor-A and publishes exact successor identity', async () => {
    const coordinator = new PreviewCoordinator();
    const first = deferred<string>();
    const successor = deferred<string>();
    const executions = [first.promise, successor.promise];
    const runner = new OriginalPreviewEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      execute: () => executions.shift() ?? Promise.reject(new Error('unexpected execution')),
    });
    const firstA = session();
    const b = session({ imageSessionId: 2, sourceImagePath: '/fixtures/b.raw', sourceRevision: 2 });
    const successorA = session({ imageSessionId: 3, sourceRevision: 3 });

    runner.request(firstA, request(firstA));
    await tick();
    const switched = coordinator.dispatch({ session: b, type: 'image-session-installed' });
    runner.consume(switched.effects);
    runner.request(successorA, request(successorA));
    await tick();

    first.resolve('data:image/jpeg;base64,stale-a');
    await tick();
    successor.resolve('data:image/jpeg;base64,successor-a');
    await tick();

    expect(coordinator.snapshot().staleCompletionCount).toBe(1);
    expect(coordinator.snapshot().originalArtifact).toMatchObject({
      identity: { session: { imageSessionId: 3, sourceImagePath: '/fixtures/a.raw', sourceRevision: 3 } },
      url: 'data:image/jpeg;base64,successor-a',
    });
  });

  test('new viewport, geometry, proof, and display identities supersede running work', async () => {
    const coordinator = new PreviewCoordinator();
    const old = deferred<string>();
    const current = deferred<string>();
    const executions = [old.promise, current.promise];
    const runner = new OriginalPreviewEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      execute: () => executions.shift() ?? Promise.reject(new Error('unexpected execution')),
    });
    const base = session();
    const changed = session({
      displayGeneration: 2,
      geometryRevision: 2,
      proofRevision: 2,
      targetHeight: 1800,
      targetWidth: 1800,
      viewportRevision: 2,
    });

    runner.request(base, request(base));
    await tick();
    runner.request(changed, request(changed));
    await tick();
    old.resolve('data:image/jpeg;base64,old');
    current.resolve('data:image/jpeg;base64,current');
    await tick();

    expect(coordinator.snapshot().originalArtifact?.url).toBe('data:image/jpeg;base64,current');
    expect(runner.needsRequest(changed, 1800)).toBe(false);
    expect(runner.needsRequest(changed, 2200)).toBe(true);
  });

  test('abort before scheduled execution and unmount cancel native work and publication', async () => {
    const coordinator = new PreviewCoordinator();
    let executions = 0;
    const runner = new OriginalPreviewEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      execute: async () => {
        executions += 1;
        return 'data:image/jpeg;base64,unexpected';
      },
    });
    const identity = session();

    runner.request(identity, request(identity), 25);
    runner.dispose();
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(executions).toBe(0);
    expect(coordinator.snapshot().originalArtifact).toBeNull();
    expect(coordinator.snapshot().original.status).toBe('idle');
  });

  test('unmount while native work is running rejects its late completion', async () => {
    const coordinator = new PreviewCoordinator();
    const native = deferred<string>();
    const runner = new OriginalPreviewEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      execute: () => native.promise,
    });
    const identity = session();

    runner.request(identity, request(identity));
    await tick();
    runner.dispose();
    native.resolve('data:image/jpeg;base64,late');
    await tick();

    expect(coordinator.snapshot().originalArtifact).toBeNull();
    expect(coordinator.snapshot().staleCompletionCount).toBe(1);
  });

  test('reports one current error and permits an exact retry', async () => {
    const coordinator = new PreviewCoordinator();
    const failures: string[] = [];
    let attempt = 0;
    const runner = new OriginalPreviewEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      execute: async (input) => {
        attempt += 1;
        if (attempt === 1) throw new Error('native preview failed');
        expect(input.expectedImagePath).toBe('/fixtures/a.raw');
        expect(input.viewerSampleGraphRevision).toBe(session().graphRevision);
        return 'data:image/jpeg;base64,retry';
      },
      onCurrentFailure: (error) => failures.push(String(error)),
    });
    const identity = session();

    runner.request(identity, request(identity));
    await tick();
    expect(coordinator.snapshot().original.status).toBe('failed');
    runner.request(identity, request(identity));
    await tick();

    expect(failures).toEqual(['Error: native preview failed']);
    expect(coordinator.snapshot().originalArtifact?.url).toBe('data:image/jpeg;base64,retry');
    expect(attempt).toBe(2);
  });
});
