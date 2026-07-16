import { describe, expect, test } from 'bun:test';

import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  fingerprintPreviewSessionIdentity,
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewCoordinatorEvent,
  type PreviewInvalidationRequest,
  type PreviewSchedulingInputSnapshot,
} from '../../../src/utils/previewCoordinator';
import { PreviewInvalidationEffectRunner } from '../../../src/utils/previewInvalidationEffectRunner';
import { PreviewRequestIntentAdapter } from '../../../src/utils/previewRequestIntentAdapter';
import {
  PreviewRequestScopeAdapter,
  type PreviewRequestScopeInput,
} from '../../../src/utils/previewRequestScopeAdapter';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const source = (path: string, imageSessionId: number): PreviewRequestScopeInput => {
  const adjustmentSnapshot = publishAdjustmentSnapshot(null, structuredClone(INITIAL_ADJUSTMENTS));
  return {
    adjustmentRevision: adjustmentSnapshot.renderRevision,
    adjustmentSnapshot,
    autoEditPreviewSession: null,
    baseRenderSize: {
      containerHeight: 800,
      containerWidth: 1200,
      height: 800,
      offsetX: 0,
      offsetY: 0,
      width: 1200,
    },
    basicToneSliderInteraction: null,
    finalPreviewUrl: `blob:${path}`,
    hasRenderedFirstFrame: false,
    imageSession: { id: `session:${String(imageSessionId)}:${path}` },
    imageSessionId,
    previewViewportTransform: { positionX: 0, positionY: 0, scale: 1 },
    proofRevision: 1,
    referenceMatchPreview: null,
    selectedImage: { isReady: true, path, thumbnailUrl: `blob:thumb:${path}` },
    settings: { editorPreviewResolution: 1200, enableZoomHifi: true, useWgpuRenderer: false },
    zoomMode: { kind: 'fit' },
  };
};

const displayPayload = (displayResourceGeneration: number) => ({
  deviceGeneration: displayResourceGeneration,
  displayResourceGeneration,
  target: {
    colorSpace: 'display_encoded_srgb' as const,
    displayId: 1,
    profileSha256: `profile-${String(displayResourceGeneration)}`,
    scaleFactorBits: 1,
  },
});

const inputFactory = (
  coordinator: PreviewCoordinator,
  getSource: () => PreviewRequestScopeInput,
): ((scopeRecovery: boolean, targetResolution: number) => PreviewSchedulingInputSnapshot) => {
  const scopeAdapter = new PreviewRequestScopeAdapter({
    getDisplayGeneration: () => coordinator.snapshot().displayGeneration,
  });
  return (scopeRecovery, targetResolution) => {
    const currentSource = getSource();
    const adapter = new PreviewRequestIntentAdapter({
      captureScope: (resolution, roi) => scopeAdapter.capture(currentSource, resolution, roi, 1),
      decideQuality: (resolution) => ({
        backend: 'cpu',
        effectiveRoi: null,
        effectiveTargetResolution: resolution,
        estimatedWorkingBytes: 1,
        limitedBy: null,
        reason: 'invalidation recovery',
        requestedTargetResolution: resolution,
        sufficientForSemanticZoom: true,
        tier: 'settled_full',
      }),
      dispatch: () => undefined,
      installSession: () => undefined,
      publish: () => undefined,
      schedule: () => {
        throw new Error('The coordinator must schedule captured invalidation input.');
      },
    });
    const edited = adapter.prepare({
      activeWaveformChannel: null,
      delayMs: 0,
      dragging: false,
      isWaveformVisible: false,
      proofRecipe: null,
      requestedTargetResolution: targetResolution,
      scopeRecovery,
    });
    if (edited === null) throw new Error('Expected captured invalidation input.');
    return {
      compareActive: false,
      devicePixelRatio: 1,
      displayHeight: 800,
      displayWidth: 1200,
      edited,
      enableLivePreviews: true,
      original: null,
      ready: true,
    };
  };
};

const harness = (subscribeDisplayTarget?: (onPayload: (payload: unknown) => void) => Promise<() => void>) => {
  const coordinator = new PreviewCoordinator();
  const effects: PreviewCoordinatorEffect[] = [];
  let runner: PreviewInvalidationEffectRunner;
  const dispatch = (event: PreviewCoordinatorEvent) => {
    const transition = coordinator.dispatch(event);
    effects.push(...transition.effects);
    runner?.consume(transition.effects);
    return transition;
  };
  runner = new PreviewInvalidationEffectRunner({
    dispatch,
    getState: () => coordinator.snapshot(),
    ...(subscribeDisplayTarget === undefined ? {} : { subscribeDisplayTarget }),
  });
  return { coordinator, dispatch, effects, runner };
};

describe('preview invalidation effect runner', () => {
  test('repeated recovery IDs schedule exactly one recovery at the configured resolution', () => {
    const { coordinator, effects, runner } = harness(async () => () => undefined);
    const currentSource = source('/fixtures/a.raw', 1);
    const capture = inputFactory(coordinator, () => currentSource);
    const initial = capture(false, 1200);
    if (initial.edited === null) throw new Error('Expected initial edited input.');
    const captures: Array<{ scopeRecovery: boolean; targetResolution: number }> = [];
    const trackedCapture = (scopeRecovery: boolean, targetResolution: number) => {
      captures.push({ scopeRecovery, targetResolution });
      return capture(scopeRecovery, targetResolution);
    };

    runner.start();
    runner.installSession(initial.edited.request.session, 0);
    runner.updateSource({ capture: trackedCapture, scopeRecoveryRequestId: 0, targetResolution: 1600 });
    runner.updateSource({ capture: trackedCapture, scopeRecoveryRequestId: 1, targetResolution: 1600 });
    runner.updateSource({ capture: trackedCapture, scopeRecoveryRequestId: 1, targetResolution: 1600 });

    expect(captures).toEqual([{ scopeRecovery: true, targetResolution: 1600 }]);
    expect(effects.filter((effect) => effect.type === 'schedule-edited')).toHaveLength(1);
    expect(coordinator.snapshot().handledScopeRecoveryRequestId).toBe(1);
  });

  test('reordered, duplicate, and malformed display events cannot schedule', async () => {
    const subscription: { emit?: (payload: unknown) => void } = {};
    const { coordinator, effects, runner } = harness(async (onPayload) => {
      subscription.emit = onPayload;
      return () => undefined;
    });
    const currentSource = source('/fixtures/a.raw', 1);
    const capture = inputFactory(coordinator, () => currentSource);
    const initial = capture(false, 1200);
    if (initial.edited === null) throw new Error('Expected initial edited input.');
    const captures: number[] = [];

    runner.start();
    await tick();
    runner.installSession(initial.edited.request.session, 0);
    runner.updateSource({
      capture: (scopeRecovery, resolution) => {
        expect(scopeRecovery).toBe(false);
        captures.push(resolution);
        return capture(scopeRecovery, resolution);
      },
      scopeRecoveryRequestId: 0,
      targetResolution: 1400,
    });
    if (subscription.emit === undefined) throw new Error('Expected display event subscription.');
    subscription.emit(displayPayload(3));
    subscription.emit(displayPayload(2));
    subscription.emit(displayPayload(3));
    subscription.emit({ displayResourceGeneration: 'invalid' });

    expect(captures).toEqual([1400]);
    expect(effects.filter((effect) => effect.type === 'schedule-edited')).toHaveLength(1);
    expect(coordinator.snapshot().displayGeneration).toBe(3);
  });

  test('A to B to successor-A rejects delayed captured input and schedules only the successor', () => {
    const { coordinator, dispatch } = harness(async () => () => undefined);
    let currentSource = source('/fixtures/a.raw', 1);
    const capture = inputFactory(coordinator, () => currentSource);
    const firstA = capture(false, 1200);
    if (firstA.edited === null) throw new Error('Expected first A input.');
    dispatch({
      scopeRecoveryRequestId: 0,
      session: firstA.edited.request.session,
      type: 'invalidation-source-installed',
    });
    const staleInvalidation: PreviewInvalidationRequest = {
      displayGeneration: 1,
      reason: 'scope-recovery-requested',
      requestId: 1,
      sessionFingerprint: fingerprintPreviewSessionIdentity(firstA.edited.request.session),
      targetResolution: 1200,
    };
    const requested = coordinator.dispatch({
      invalidation: staleInvalidation,
      type: 'preview-invalidation-requested',
    });
    expect(requested.effects).toContainEqual({
      invalidation: staleInvalidation,
      scopeRecovery: true,
      type: 'capture-invalidation',
    });

    currentSource = source('/fixtures/b.raw', 2);
    const b = capture(false, 1200);
    if (b.edited === null) throw new Error('Expected B input.');
    dispatch({ scopeRecoveryRequestId: 0, session: b.edited.request.session, type: 'invalidation-source-installed' });
    currentSource = source('/fixtures/a.raw', 3);
    const successorA = capture(false, 1200);
    if (successorA.edited === null) throw new Error('Expected successor A input.');
    dispatch({
      scopeRecoveryRequestId: 0,
      session: successorA.edited.request.session,
      type: 'invalidation-source-installed',
    });
    const stale = coordinator.dispatch({
      inputs: firstA,
      invalidation: staleInvalidation,
      type: 'preview-invalidation-captured',
    });
    expect(stale.effects).toEqual([]);
    expect(stale.state.lastTransition?.reason).toBe('captured-invalidation-stale');

    const successorInvalidation: PreviewInvalidationRequest = {
      displayGeneration: 1,
      reason: 'scope-recovery-requested',
      requestId: 1,
      sessionFingerprint: fingerprintPreviewSessionIdentity(successorA.edited.request.session),
      targetResolution: 1200,
    };
    coordinator.dispatch({ invalidation: successorInvalidation, type: 'preview-invalidation-requested' });
    const successor = coordinator.dispatch({
      inputs: capture(true, 1200),
      invalidation: successorInvalidation,
      type: 'preview-invalidation-captured',
    });
    expect(successor.effects.filter((effect) => effect.type === 'schedule-edited')).toHaveLength(1);
  });

  test('captured recovery rejects changed graph and geometry on the same source session', () => {
    const { coordinator } = harness(async () => () => undefined);
    const currentSource = source('/fixtures/a.raw', 1);
    const capture = inputFactory(coordinator, () => currentSource);
    const initial = capture(false, 1200);
    if (initial.edited === null) throw new Error('Expected initial edited input.');
    const initialSession = initial.edited.request.session;
    coordinator.dispatch({ scopeRecoveryRequestId: 0, session: initialSession, type: 'invalidation-source-installed' });
    const invalidation: PreviewInvalidationRequest = {
      displayGeneration: 1,
      reason: 'scope-recovery-requested',
      requestId: 1,
      sessionFingerprint: fingerprintPreviewSessionIdentity(initialSession),
      targetResolution: 1200,
    };
    coordinator.dispatch({ invalidation, type: 'preview-invalidation-requested' });
    coordinator.dispatch({
      scopeRecoveryRequestId: 1,
      session: {
        ...initialSession,
        adjustmentRevision: 2,
        geometryRevision: 2,
        graphRevision: 'same-source-new-graph',
      },
      type: 'invalidation-source-installed',
    });

    const stale = coordinator.dispatch({ inputs: initial, invalidation, type: 'preview-invalidation-captured' });
    expect(stale.effects).toEqual([]);
    expect(stale.state.lastTransition?.reason).toBe('captured-invalidation-stale');
  });

  test('listener setup resolved after unmount is disposed and cannot have a late effect', async () => {
    const listener: {
      emit?: (payload: unknown) => void;
      resolve?: (unlisten: () => void) => void;
    } = {};
    let unlistenCount = 0;
    const subscription = new Promise<() => void>((resolve) => {
      listener.resolve = resolve;
    });
    const { coordinator, runner } = harness((onPayload) => {
      listener.emit = onPayload;
      return subscription;
    });
    const currentSource = source('/fixtures/a.raw', 1);
    const capture = inputFactory(coordinator, () => currentSource);
    const initial = capture(false, 1200);
    if (initial.edited === null) throw new Error('Expected initial edited input.');

    runner.start();
    runner.installSession(initial.edited.request.session, 0);
    runner.updateSource({ capture, scopeRecoveryRequestId: 0, targetResolution: 1200 });
    runner.stop('editor-unmounted');
    if (listener.resolve === undefined) throw new Error('Expected pending listener setup.');
    listener.resolve(() => {
      unlistenCount += 1;
    });
    await tick();
    if (listener.emit === undefined) throw new Error('Expected captured display callback.');
    listener.emit(displayPayload(2));

    expect(unlistenCount).toBe(1);
    expect(coordinator.snapshot().session).toBeNull();
    expect(coordinator.snapshot().displayGeneration).toBe(1);
  });
});
