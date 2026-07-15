import { describe, expect, test } from 'bun:test';

import type { PreviewQualityDecision } from '../../../src/utils/adaptivePreviewQuality';
import type { InteractivePreviewIdentity } from '../../../src/utils/interactivePreviewPatch';
import {
  PreviewCoordinator,
  type PreviewOperationIdentity,
  type PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';
import {
  PreviewFailureAdapter,
  type PreviewFailureContext,
  type PreviewFailureUpdate,
} from '../../../src/utils/previewFailureAdapter';

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => ({
  adjustmentRevision: 1,
  backend: 'cpu',
  displayGeneration: 1,
  geometryRevision: 1,
  graphRevision: 'graph-a',
  imageSessionId: 1,
  maskRevision: 1,
  patchRevision: 1,
  proofRevision: 1,
  roiFingerprint: '[0,0,1,1]',
  sourceImagePath: '/fixtures/a.raw',
  sourceRevision: 1,
  targetHeight: 1200,
  targetWidth: 1200,
  viewportRevision: 1,
  ...overrides,
});

const quality: PreviewQualityDecision = {
  backend: 'cpu',
  effectiveRoi: null,
  effectiveTargetResolution: 1200,
  estimatedWorkingBytes: 1,
  limitedBy: null,
  reason: 'settled viewport',
  requestedTargetResolution: 1200,
  sufficientForSemanticZoom: true,
  tier: 'settled_full',
};

const interactiveIdentity = (identity: PreviewOperationIdentity): InteractivePreviewIdentity => ({
  adjustmentRevision: identity.session.adjustmentRevision,
  backend: identity.session.backend,
  backendEpoch: 1,
  basePreviewUrl: 'blob:base',
  devicePixelRatio: 2,
  devicePixelRatioEpoch: 1,
  generation: identity.generation,
  geometryEpoch: 1,
  geometryIdentity: identity.session.geometryRevision,
  graphEpoch: 1,
  graphIdentity: identity.session.graphRevision,
  imageSessionId: identity.session.imageSessionId,
  maskRevision: identity.session.maskRevision,
  patchRevision: identity.session.patchRevision,
  proofRevision: identity.session.proofRevision,
  roiEpoch: 1,
  roiH: null,
  roiW: null,
  roiX: null,
  roiY: null,
  selectionEpoch: 1,
  sourceImagePath: identity.session.sourceImagePath,
  targetResolution: identity.session.targetWidth,
  viewportEpoch: 1,
  viewportIdentity: identity.session.viewportRevision,
});

const context = (identity: PreviewOperationIdentity, scopeRecovery = false): PreviewFailureContext => ({
  identity,
  interactiveIdentity: interactiveIdentity(identity),
  quality,
  scopeRecovery,
});

const start = (coordinator: PreviewCoordinator, input: PreviewSessionIdentity): PreviewOperationIdentity => {
  const queued = coordinator.dispatch({ identity: input, kind: 'settled', type: 'render-inputs-changed' });
  const identity = queued.state.settled.identity;
  if (identity === undefined) throw new Error('Expected a settled identity.');
  coordinator.dispatch({ identity, type: 'operation-started' });
  return identity;
};

class FakeClock {
  private jobs: Array<{ callback: () => void; at: number }> = [];

  schedule(callback: () => void, at: number): void {
    this.jobs.push({ at, callback });
  }

  run(): void {
    this.jobs.sort((left, right) => left.at - right.at);
    for (const job of this.jobs) job.callback();
  }
}

const harness = () => {
  const coordinator = new PreviewCoordinator();
  const reported: string[] = [];
  const updates: PreviewFailureUpdate[] = [];
  const adapter = new PreviewFailureAdapter({
    getCoordinatorState: () => coordinator.snapshot(),
    publish: (update) => updates.push(update),
    reportError: (error) => reported.push(String(error)),
  });
  return { adapter, coordinator, reported, updates };
};

describe('preview failure adapter', () => {
  test('current recovery failure publishes once with exact operation identity', () => {
    const { adapter, coordinator, reported, updates } = harness();
    const identity = start(coordinator, session());
    coordinator.dispatch({ error: 'native failed', identity, type: 'operation-failed' });

    expect(adapter.fail(new Error('native failed'), context(identity, true))).toBe(true);
    expect(adapter.fail(new Error('native failed'), context(identity, true))).toBe(false);
    expect(reported).toEqual(['Error: native failed']);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      previewQualityStatus: { reason: 'render_error', requestId: identity.operationId },
      previewScopeRecoveryError: 'native failed',
      previewScopeRecoveryState: 'error',
    });
  });

  test('expected supersession stays silent even if reported as the current failure', () => {
    const { adapter, coordinator, reported, updates } = harness();
    const identity = start(coordinator, session());
    coordinator.dispatch({ error: 'preview_superseded', identity, type: 'operation-failed' });

    expect(adapter.fail(new Error('preview_superseded'), context(identity))).toBe(false);
    expect(reported).toEqual([]);
    expect(updates).toEqual([]);
  });

  test('fake-time reordered old and new failures publish only the exact newest failure', () => {
    const { adapter, coordinator, reported, updates } = harness();
    const clock = new FakeClock();
    const old = start(coordinator, session());
    coordinator.dispatch({ error: 'old failed', identity: old, type: 'operation-failed' });
    const current = start(coordinator, session({ adjustmentRevision: 2, graphRevision: 'graph-2' }));
    coordinator.dispatch({ error: 'current failed', identity: current, type: 'operation-failed' });

    clock.schedule(() => void adapter.fail(new Error('current failed'), context(current)), 10);
    clock.schedule(() => void adapter.fail(new Error('old failed'), context(old)), 20);
    clock.run();

    expect(reported).toEqual(['Error: current failed']);
    expect(updates.map((update) => update.previewQualityStatus.requestId)).toEqual([current.operationId]);
  });

  test('a newer success makes a delayed older failure inert', () => {
    const { adapter, coordinator, reported, updates } = harness();
    const old = start(coordinator, session());
    const current = start(coordinator, session({ adjustmentRevision: 2, graphRevision: 'graph-2' }));
    coordinator.dispatch({ identity: current, type: 'operation-completed' });
    coordinator.dispatch({ error: 'late old failure', identity: old, type: 'operation-failed' });

    expect(adapter.fail(new Error('late old failure'), context(old))).toBe(false);
    expect(reported).toEqual([]);
    expect(updates).toEqual([]);
  });
});
