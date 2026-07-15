import { describe, expect, test } from 'bun:test';

import {
  PreviewAnalyticsEffectRunner,
  type PreviewAnalyticsPresentationState,
  type PreviewAnalyticsUpdate,
} from '../../../src/utils/previewAnalyticsEffectRunner';
import {
  PreviewCoordinator,
  type PreviewCoordinatorEvent,
  type PreviewOperationIdentity,
  type PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => ({
  adjustmentRevision: 1,
  backend: 'cpu',
  displayGeneration: 1,
  geometryRevision: 0,
  graphRevision: 'graph-a',
  imageSessionId: 1,
  maskRevision: 0,
  patchRevision: 0,
  proofRevision: 0,
  roiFingerprint: '[0,0,1,1]',
  sourceImagePath: '/fixtures/a.raw',
  sourceRevision: 1,
  targetHeight: 1200,
  targetWidth: 1200,
  viewportRevision: 1,
  ...overrides,
});

const analyticsPayload = (identity: PreviewOperationIdentity, marker = 1) => ({
  frameId: {
    graphRevision: identity.operationId,
    imageSession: identity.session.imageSessionId,
    previewGeneration: identity.generation,
  },
  gamut: null,
  histogram: { blue: [marker], green: [marker], luma: [marker], red: [marker] },
  path: identity.session.sourceImagePath,
  previewOperationIdentity: identity,
  requestedProducts: 1,
  scopes: null,
  spatial: null,
  timing: { finishingMs: 0, fullImageConversions: 0, samplingMs: 0, sourcePixelsRead: 1 },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const harness = () => {
  const coordinator = new PreviewCoordinator();
  const updates: PreviewAnalyticsUpdate[] = [];
  let emit: ((payload: unknown) => void) | null = null;
  const presentationState: PreviewAnalyticsPresentationState = {
    exportSoftProofTransform: null,
    isExportSoftProofEnabled: false,
    selectedImagePath: '/fixtures/a.raw',
  };
  let runner: PreviewAnalyticsEffectRunner;
  const dispatch = (event: PreviewCoordinatorEvent) => {
    const transition = coordinator.dispatch(event);
    runner?.consume(transition.effects);
    return transition;
  };
  runner = new PreviewAnalyticsEffectRunner({
    dispatch,
    now: () => new Date('2026-07-15T12:00:00.000Z'),
    publish: (update) => updates.push(update),
    subscribe: async (onPayload) => {
      emit = onPayload;
      return () => undefined;
    },
  });
  return {
    coordinator,
    dispatch,
    emit: (payload: unknown) => {
      if (emit === null) throw new Error('Analytics listener is not ready.');
      emit(payload);
    },
    runner,
    bindPresentation: (identity: PreviewOperationIdentity, state = presentationState) =>
      runner.bindPresentation(identity, state),
    updates,
  };
};

const requiredIdentity = (transition: ReturnType<PreviewCoordinator['dispatch']>): PreviewOperationIdentity => {
  const identity = transition.state.settled.identity;
  if (identity === undefined) throw new Error('Expected settled identity.');
  return identity;
};

describe('preview analytics effect runner', () => {
  test('early analytics publishes only after exact artifact presentation and stale results cannot mutate output', async () => {
    const { bindPresentation, dispatch, emit, runner, updates } = harness();
    await runner.start();
    const queued = dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
    const identity = requiredIdentity(queued);
    dispatch({ identity, type: 'operation-started' });
    emit(analyticsPayload(identity));
    expect(updates).toEqual([]);
    dispatch({ artifact: { identity, url: 'blob:current' }, identity, type: 'operation-completed' });
    expect(updates).toEqual([]);
    expect(bindPresentation(identity)).toBe(true);
    expect(updates.at(-1)).toMatchObject({
      histogram: { luma: { data: [1] } },
      previewScopeStatus: { path: '/fixtures/a.raw', updatedAt: '2026-07-15T12:00:00.000Z' },
    });

    const stale = { ...identity, generation: identity.generation + 1, operationId: identity.operationId + 1 };
    emit(analyticsPayload(stale, 9));
    expect(updates).toHaveLength(1);
    expect(runner.pendingCount()).toBe(0);
  });

  test('replacement clears prior analytics and unmount drops pending payloads', async () => {
    const { bindPresentation, coordinator, dispatch, emit, runner, updates } = harness();
    await runner.start();
    const first = dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
    const firstIdentity = requiredIdentity(first);
    dispatch({ identity: firstIdentity, type: 'operation-started' });
    emit(analyticsPayload(firstIdentity));
    dispatch({
      artifact: { identity: firstIdentity, url: 'blob:first' },
      identity: firstIdentity,
      type: 'operation-completed',
    });
    bindPresentation(firstIdentity);

    const second = dispatch({
      identity: session({ adjustmentRevision: 2, graphRevision: 'graph-b' }),
      kind: 'settled',
      type: 'render-inputs-changed',
    });
    const secondIdentity = requiredIdentity(second);
    dispatch({ identity: secondIdentity, type: 'operation-started' });
    dispatch({
      artifact: { identity: secondIdentity, url: 'blob:second' },
      identity: secondIdentity,
      type: 'operation-completed',
    });
    bindPresentation(secondIdentity);
    expect(updates.at(-1)).toEqual({
      histogram: null,
      previewScopeStatus: null,
      referenceMatchSpatialAnalysis: null,
      waveform: null,
    });

    emit(analyticsPayload(secondIdentity, 2));
    expect(updates.at(-1)).toMatchObject({ histogram: { luma: { data: [2] } } });
    dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });
    runner.stop();
    expect(runner.pendingCount()).toBe(0);
    expect(coordinator.snapshot().analytics.status).toBe('idle');
    expect(updates.at(-1)?.histogram).toBeNull();
  });

  test('late analytics uses proof metadata captured with the exact presented artifact', async () => {
    const { bindPresentation, dispatch, emit, runner, updates } = harness();
    await runner.start();
    const queued = dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
    const identity = requiredIdentity(queued);
    dispatch({ identity, type: 'operation-started' });
    const proofA: PreviewAnalyticsPresentationState = {
      exportSoftProofTransform: {
        blackPointCompensation: 'enabled',
        colorManagedTransform: 'Display P3 → sRGB',
        effectiveColorProfile: 'sRGB IEC61966-2.1',
        effectiveRenderingIntent: 'relative_colorimetric',
        policyStatus: 'applied',
        policyVersion: '1',
        sourcePrecisionPath: 'f32',
        transformApplied: true,
        transformPolicyFingerprint: 'proof-a',
      },
      isExportSoftProofEnabled: true,
      selectedImagePath: '/fixtures/a.raw',
    };
    dispatch({ artifact: { identity, url: 'blob:proof-a' }, identity, type: 'operation-completed' });
    expect(bindPresentation(identity, proofA)).toBe(true);

    emit(analyticsPayload(identity));

    expect(updates.at(-1)?.previewScopeStatus).toMatchObject({
      displayTransformLabel: 'Display P3 → sRGB',
      exportProfileLabel: 'sRGB IEC61966-2.1',
      exportRenderingIntentLabel: 'relative_colorimetric',
      renderBasis: 'export_preview',
      softProofTransformApplied: true,
    });
  });

  test('successor publication rejects a late predecessor binding and flushes only successor analytics', async () => {
    const { bindPresentation, dispatch, emit, runner, updates } = harness();
    await runner.start();
    const first = dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
    const firstIdentity = requiredIdentity(first);
    dispatch({ identity: firstIdentity, type: 'operation-started' });
    emit(analyticsPayload(firstIdentity, 1));
    dispatch({
      artifact: { identity: firstIdentity, url: 'blob:first' },
      identity: firstIdentity,
      type: 'operation-completed',
    });

    const successor = dispatch({
      identity: session({ adjustmentRevision: 2, graphRevision: 'graph-successor', proofRevision: 2 }),
      kind: 'settled',
      type: 'render-inputs-changed',
    });
    const successorIdentity = requiredIdentity(successor);
    dispatch({ identity: successorIdentity, type: 'operation-started' });
    emit(analyticsPayload(successorIdentity, 2));
    dispatch({
      artifact: { identity: successorIdentity, url: 'blob:successor' },
      identity: successorIdentity,
      type: 'operation-completed',
    });

    expect(bindPresentation(firstIdentity)).toBe(false);
    expect(updates).toEqual([
      {
        histogram: null,
        previewScopeStatus: null,
        referenceMatchSpatialAnalysis: null,
        waveform: null,
      },
    ]);
    expect(
      bindPresentation(successorIdentity, {
        exportSoftProofTransform: null,
        isExportSoftProofEnabled: true,
        selectedImagePath: '/fixtures/a.raw',
      }),
    ).toBe(true);
    expect(updates.at(-1)).toMatchObject({ histogram: { luma: { data: [2] } } });
    expect(runner.pendingCount()).toBe(0);
  });

  test('start resolves only after the analytics subscription is installed', async () => {
    let install: ((unlisten: () => void) => void) | null = null;
    const coordinator = new PreviewCoordinator();
    const runner = new PreviewAnalyticsEffectRunner({
      dispatch: (event) => coordinator.dispatch(event),
      publish: () => undefined,
      subscribe: () =>
        new Promise((resolve) => {
          install = resolve;
        }),
    });
    let ready = false;
    const started = runner.start().then(() => {
      ready = true;
    });
    await tick();
    expect(ready).toBe(false);
    if (install === null) throw new Error('Expected analytics subscription installer.');
    install(() => undefined);
    await started;
    expect(ready).toBe(true);
  });
});
