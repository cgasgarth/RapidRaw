import { type AdjustmentSnapshot, publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  createPreviewCoordinatorState,
  createPreviewQualityPolicy,
  fingerprintPreviewGraphRevision,
  fingerprintPreviewOperationIdentity,
  fingerprintPreviewRoi,
  fingerprintPreviewSessionIdentity,
  type PreviewArtifact,
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewSchedulingInputSnapshot,
  type PreviewSessionIdentity,
  quantizePreviewRoi,
  reducePreviewCoordinator,
  resolvePreviewViewportRoi,
} from '../../../src/utils/previewCoordinator';
import { PreviewRequestIntentAdapter } from '../../../src/utils/previewRequestIntentAdapter';
import {
  PreviewRequestScopeAdapter,
  type PreviewRequestScopeInput,
} from '../../../src/utils/previewRequestScopeAdapter';

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => {
  const values = {
    adjustmentRevision: 1,
    backend: 'wgpu' as const,
    displayGeneration: 1,
    geometryRevision: 1,
    imageSessionId: 1,
    maskRevision: 1,
    patchRevision: 1,
    proofRevision: 1,
    roiFingerprint: 'full',
    sourceImagePath: 'fixtures/landscape.arw',
    sourceRevision: 1,
    targetHeight: 1000,
    targetWidth: 1600,
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

const artifact = (identity: PreviewArtifact['identity'], url: string): PreviewArtifact => ({ identity, url });

function transition(
  state: ReturnType<typeof createPreviewCoordinatorState>,
  event: Parameters<typeof reducePreviewCoordinator>[1],
) {
  return reducePreviewCoordinator(state, event);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected coordinator operation identity');
  return value;
}

const schedulingInputHarness = () => {
  const scopeAdapter = new PreviewRequestScopeAdapter({ getDisplayGeneration: () => 1 });
  let previousSnapshot: AdjustmentSnapshot | null = null;
  const snapshot = (exposure: number, advance: boolean): AdjustmentSnapshot => {
    if (!advance && previousSnapshot !== null) return previousSnapshot;
    previousSnapshot = publishAdjustmentSnapshot(previousSnapshot, {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      exposure,
    });
    return previousSnapshot;
  };
  const prepare = ({
    advanceAdjustment = true,
    compareActive = false,
    devicePixelRatio = 1,
    dragging = false,
    exposure = 0,
    imageSessionId = 1,
    path = '/fixtures/a.raw',
    ready = true,
    roi = null,
    targetResolution = 1200,
  }: {
    advanceAdjustment?: boolean;
    compareActive?: boolean;
    devicePixelRatio?: number;
    dragging?: boolean;
    exposure?: number;
    imageSessionId?: number;
    path?: string;
    ready?: boolean;
    roi?: [number, number, number, number] | null;
    targetResolution?: number;
  } = {}): PreviewSchedulingInputSnapshot => {
    if (!ready) {
      return {
        compareActive,
        devicePixelRatio,
        displayHeight: 800,
        displayWidth: 1200,
        edited: null,
        enableLivePreviews: true,
        original: null,
        ready: false,
      };
    }
    const adjustmentSnapshot = snapshot(exposure, advanceAdjustment);
    const source: PreviewRequestScopeInput = {
      adjustmentRevision: adjustmentSnapshot.adjustmentRevision,
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
      previewViewportTransform: { positionX: 0, positionY: 0, scale: roi === null ? 1 : 2 },
      proofRevision: 1,
      referenceMatchPreview: null,
      selectedImage: { isReady: true, path, thumbnailUrl: `blob:thumb:${path}` },
      settings: { editorPreviewResolution: 1200, enableZoomHifi: true, useWgpuRenderer: false },
      zoomMode: { kind: 'fit' },
    };
    const adapter = new PreviewRequestIntentAdapter({
      captureScope: (resolution, effectiveRoi) =>
        scopeAdapter.capture(source, resolution, effectiveRoi, devicePixelRatio),
      decideQuality: (resolution, interacting) => ({
        backend: 'cpu',
        effectiveRoi: roi,
        effectiveTargetResolution: resolution,
        estimatedWorkingBytes: 1,
        limitedBy: null,
        reason: interacting ? 'interactive viewport' : 'settled viewport',
        requestedTargetResolution: resolution,
        sufficientForSemanticZoom: true,
        tier: interacting ? 'interaction_balanced' : 'settled_full',
      }),
      dispatch: () => undefined,
      installSession: () => undefined,
      publish: () => undefined,
      schedule: () => {
        throw new Error('Scheduling must remain coordinator-owned in this harness.');
      },
    });
    const edited = adapter.prepare({
      activeWaveformChannel: null,
      delayMs: 0,
      dragging,
      isWaveformVisible: false,
      proofRecipe: null,
      requestedTargetResolution: targetResolution,
      scopeRecovery: false,
    });
    if (edited === null) throw new Error('Expected immutable scheduling input.');
    const original = compareActive
      ? {
          request: {
            expectedImagePath: edited.scope.session.sourceImagePath,
            jsAdjustments: structuredClone(INITIAL_ADJUSTMENTS),
            targetResolution: edited.scope.session.targetWidth,
            viewerSampleGraphRevision: edited.scope.session.graphRevision,
          },
          session: edited.scope.session,
          viewport: edited.scope.viewport.coordinator,
        }
      : null;
    return {
      compareActive,
      devicePixelRatio,
      displayHeight: 800,
      displayWidth: 1200,
      edited,
      enableLivePreviews: true,
      original,
      ready: true,
    };
  };
  return { prepare };
};

test('session-owned scheduling emits interactive work and exactly one settled successor', () => {
  const { prepare } = schedulingInputHarness();
  let state = createPreviewCoordinatorState();
  const initialInputs = prepare();
  const initial = transition(state, { inputs: initialInputs, type: 'scheduling-inputs-changed' });
  expect(initial.effects).toMatchObject([
    { causalGeneration: 1, delayMs: 50, reason: 'settled-inputs-changed', type: 'schedule-edited' },
  ]);
  state = initial.state;
  expect(transition(state, { inputs: initialInputs, type: 'scheduling-inputs-changed' }).effects).toEqual([]);

  const firstDrag = transition(state, {
    inputs: prepare({ dragging: true, exposure: 0.1 }),
    type: 'scheduling-inputs-changed',
  });
  expect(firstDrag.effects).toMatchObject([
    { causalGeneration: 2, delayMs: 0, reason: 'interactive-inputs-changed', type: 'schedule-edited' },
  ]);
  const secondDrag = transition(firstDrag.state, {
    inputs: prepare({ dragging: true, exposure: 0.2 }),
    type: 'scheduling-inputs-changed',
  });
  expect(secondDrag.effects).toMatchObject([
    { causalGeneration: 2, delayMs: 0, reason: 'interactive-inputs-changed', type: 'schedule-edited' },
  ]);

  const settledInputs = prepare({ dragging: false, exposure: 0.2 });
  const settled = transition(secondDrag.state, {
    inputs: settledInputs,
    type: 'scheduling-inputs-changed',
  });
  expect(settled.effects).toMatchObject([
    { causalGeneration: 3, delayMs: 50, reason: 'interaction-settled-successor', type: 'schedule-edited' },
  ]);
  expect(transition(settled.state, { inputs: settledInputs, type: 'scheduling-inputs-changed' }).effects).toEqual([]);
});

test('causal generations keep every drag frame together and reject delayed work after the settled successor', () => {
  const { prepare } = schedulingInputHarness();
  const requiredSchedule = (effects: readonly PreviewCoordinatorEffect[]) => {
    const effect = effects.find((candidate) => candidate.type === 'schedule-edited');
    if (effect?.type !== 'schedule-edited') throw new Error('Expected edited scheduling effect.');
    return effect;
  };
  let state = createPreviewCoordinatorState();

  const initial = transition(state, { inputs: prepare(), type: 'scheduling-inputs-changed' });
  const initialSchedule = requiredSchedule(initial.effects);
  const initialQueued = transition(initial.state, {
    causalGeneration: initialSchedule.causalGeneration,
    identity: initialSchedule.prepared.request.session,
    kind: 'settled',
    type: 'render-inputs-changed',
  });

  const firstDrag = transition(initialQueued.state, {
    inputs: prepare({ dragging: true, exposure: 0.1 }),
    type: 'scheduling-inputs-changed',
  });
  const firstDragSchedule = requiredSchedule(firstDrag.effects);
  const firstDragQueued = transition(firstDrag.state, {
    causalGeneration: firstDragSchedule.causalGeneration,
    identity: firstDragSchedule.prepared.request.session,
    kind: 'interactive',
    type: 'render-inputs-changed',
  });
  const firstDragIdentity = required(firstDragQueued.state.interactive.identity);

  const secondDrag = transition(firstDragQueued.state, {
    inputs: prepare({ dragging: true, exposure: 0.2 }),
    type: 'scheduling-inputs-changed',
  });
  const secondDragSchedule = requiredSchedule(secondDrag.effects);
  const secondDragQueued = transition(secondDrag.state, {
    causalGeneration: secondDragSchedule.causalGeneration,
    identity: secondDragSchedule.prepared.request.session,
    kind: 'interactive',
    type: 'render-inputs-changed',
  });
  const secondDragIdentity = required(secondDragQueued.state.interactive.identity);
  state = transition(secondDragQueued.state, { identity: secondDragIdentity, type: 'operation-started' }).state;

  const released = transition(state, {
    inputs: prepare({ dragging: false, exposure: 0.2 }),
    type: 'scheduling-inputs-changed',
  });
  const settledSchedule = requiredSchedule(released.effects);
  const settledQueued = transition(released.state, {
    causalGeneration: settledSchedule.causalGeneration,
    identity: settledSchedule.prepared.request.session,
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  const settledIdentity = required(settledQueued.state.settled.identity);
  state = transition(settledQueued.state, { identity: settledIdentity, type: 'operation-started' }).state;
  const completionEffects: PreviewCoordinatorEffect[] = [];
  const fakeClock = [
    {
      at: 20,
      event: {
        artifact: artifact(secondDragIdentity, 'blob:late-interactive'),
        identity: secondDragIdentity,
        type: 'operation-completed' as const,
      },
    },
    {
      at: 10,
      event: {
        artifact: artifact(settledIdentity, 'blob:settled-successor'),
        identity: settledIdentity,
        type: 'operation-completed' as const,
      },
    },
  ];
  for (const completion of fakeClock.sort((left, right) => left.at - right.at)) {
    const completed = transition(state, completion.event);
    state = completed.state;
    completionEffects.push(...completed.effects);
  }
  const staleIntent = transition(state, {
    causalGeneration: secondDragSchedule.causalGeneration,
    identity: secondDragSchedule.prepared.request.session,
    kind: 'interactive',
    type: 'render-inputs-changed',
  });

  expect(firstDragIdentity.generation).toBe(2);
  expect(secondDragIdentity.generation).toBe(2);
  expect(secondDragQueued.effects).toContainEqual({
    identity: firstDragIdentity,
    reason: 'newer-render-inputs',
    type: 'cancel',
  });
  expect(settledIdentity.generation).toBe(3);
  expect(state.visibleArtifact?.url).toBe('blob:settled-successor');
  expect(completionEffects).toContainEqual({
    reason: 'artifact-not-presented',
    type: 'release-url',
    url: 'blob:late-interactive',
  });
  expect(staleIntent.effects).toEqual([]);
  expect(staleIntent.state.lastTransition).toMatchObject({
    reason: 'stale-render-input-generation',
    staleCompletion: true,
  });
});

test('compare, target, ROI, zoom, and DPR snapshots causally schedule their successors', () => {
  const { prepare } = schedulingInputHarness();
  let state = transition(createPreviewCoordinatorState(), {
    inputs: prepare(),
    type: 'scheduling-inputs-changed',
  }).state;

  const compare = transition(state, {
    inputs: prepare({ advanceAdjustment: false, compareActive: true }),
    type: 'scheduling-inputs-changed',
  });
  expect(compare.effects).toMatchObject([
    { delayMs: 0, reason: 'compare-original-inputs-changed', type: 'schedule-original' },
  ]);
  state = compare.state;

  const targetChanged = transition(state, {
    inputs: prepare({ advanceAdjustment: false, compareActive: true, targetResolution: 1800 }),
    type: 'scheduling-inputs-changed',
  });
  expect(targetChanged.effects.some((effect) => effect.type === 'schedule-edited')).toBe(true);
  expect(targetChanged.effects.some((effect) => effect.type === 'schedule-original')).toBe(true);
  state = targetChanged.state;

  const roiChanged = transition(state, {
    inputs: prepare({
      advanceAdjustment: false,
      compareActive: true,
      roi: [0.1, 0.1, 0.5, 0.5],
      targetResolution: 1800,
    }),
    type: 'scheduling-inputs-changed',
  });
  expect(roiChanged.effects.some((effect) => effect.type === 'schedule-edited')).toBe(true);
  expect(roiChanged.effects.some((effect) => effect.type === 'schedule-original')).toBe(false);
  state = roiChanged.state;

  const dprChanged = transition(state, {
    inputs: prepare({
      advanceAdjustment: false,
      compareActive: true,
      devicePixelRatio: 2,
      roi: [0.1, 0.1, 0.5, 0.5],
      targetResolution: 1800,
    }),
    type: 'scheduling-inputs-changed',
  });
  expect(dprChanged.effects.some((effect) => effect.type === 'schedule-edited')).toBe(true);
  expect(dprChanged.effects.some((effect) => effect.type === 'schedule-original')).toBe(true);
  state = dprChanged.state;

  const disabled = transition(state, {
    inputs: prepare({ advanceAdjustment: false, compareActive: false, devicePixelRatio: 2 }),
    type: 'scheduling-inputs-changed',
  });
  expect(disabled.effects).toContainEqual({ reason: 'compare-disabled', type: 'clear-original' });
  expect(disabled.effects.some((effect) => effect.type === 'schedule-original')).toBe(false);
});

test('not-ready and unmount reset scheduling authority and release stale output exactly once', () => {
  const { prepare } = schedulingInputHarness();
  const coordinator = new PreviewCoordinator();
  const scheduled = coordinator.dispatch({
    inputs: prepare({ compareActive: true }),
    type: 'scheduling-inputs-changed',
  });
  const preparedEdited = scheduled.effects.find((effect) => effect.type === 'schedule-edited');
  if (preparedEdited?.type !== 'schedule-edited') throw new Error('Expected edited scheduling effect.');
  const queued = coordinator.dispatch({
    identity: preparedEdited.prepared.request.session,
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  const identity = required(queued.state.settled.identity);
  coordinator.dispatch({ identity, type: 'operation-started' });

  const notReady = coordinator.dispatch({ inputs: prepare({ ready: false }), type: 'scheduling-inputs-changed' });
  expect(notReady.effects).toContainEqual({ identity, reason: 'preview-inputs-not-ready', type: 'cancel' });
  expect(notReady.state.schedulingInputs?.ready).toBe(false);
  expect(
    coordinator.dispatch({ inputs: prepare({ ready: false }), type: 'scheduling-inputs-changed' }).effects,
  ).toEqual([]);

  const late = coordinator.dispatch({
    artifact: artifact(identity, 'blob:stale-after-not-ready'),
    identity,
    type: 'operation-completed',
  });
  expect(late.effects).toEqual([
    { reason: 'artifact-not-presented', type: 'release-url', url: 'blob:stale-after-not-ready' },
  ]);
  expect(late.state.visibleArtifact).toBeNull();

  const unmounted = coordinator.dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });
  expect(unmounted.state.schedulingInputs).toBeNull();
  expect(unmounted.effects).toEqual([]);
});

test('fingerprints are canonical and distinguish typed source identity changes', () => {
  expect(fingerprintPreviewSessionIdentity(session())).toBe(fingerprintPreviewSessionIdentity(session()));
  expect(fingerprintPreviewSessionIdentity(session())).not.toBe(
    fingerprintPreviewSessionIdentity(session({ sourceRevision: 2 })),
  );
});

test('synchronous current-session installation makes a later passive reinstall idempotent', () => {
  const previous = session({ imageSessionId: 4, sourceRevision: 4 });
  const current = session({ adjustmentRevision: 8, imageSessionId: 8, sourceRevision: 8 });
  let state = transition(createPreviewCoordinatorState(), {
    session: previous,
    type: 'image-session-installed',
  }).state;
  state = transition(state, { session: current, type: 'image-session-installed' }).state;
  state = transition(state, {
    identity: current,
    kind: 'settled',
    reason: 'settled-inputs-changed',
    type: 'render-inputs-changed',
  }).state;

  const passiveReinstall = transition(state, { session: current, type: 'image-session-installed' });
  expect(passiveReinstall.effects).toEqual([]);
  expect(passiveReinstall.state.settled.status).toBe('queued');
  expect(passiveReinstall.state.lastTransition?.reason).toBe('session-installed');
});

test('graph revisions canonically distinguish proposal and render-authoritative revisions', () => {
  const committed = {
    adjustmentRevision: 7,
    geometryRevision: 2,
    imageSessionId: 11,
    maskRevision: 3,
    patchRevision: 4,
    proofRevision: 5,
    proposalFingerprint: 'committed',
  };
  expect(fingerprintPreviewGraphRevision(committed)).toBe(fingerprintPreviewGraphRevision({ ...committed }));
  expect(fingerprintPreviewGraphRevision(committed)).not.toBe(
    fingerprintPreviewGraphRevision({ ...committed, proposalFingerprint: 'reference-match:proposal-2' }),
  );
  expect(fingerprintPreviewGraphRevision(committed)).not.toBe(
    fingerprintPreviewGraphRevision({ ...committed, maskRevision: committed.maskRevision + 1 }),
  );
});

test('early analytics publishes only when its exact artifact is presented and duplicates are discarded', () => {
  let state = createPreviewCoordinatorState();
  const queued = transition(state, { identity: session(), kind: 'settled', type: 'render-inputs-changed' });
  const identity = required(queued.state.settled.identity);
  state = transition(queued.state, { identity, type: 'operation-started' }).state;
  const early = transition(state, { identity, receiptId: 1, type: 'analytics-result-received' });
  expect(early.effects).toEqual([]);
  expect(early.state.pendingAnalytics).toEqual([{ identity, receiptId: 1 }]);

  const presented = transition(early.state, {
    artifact: artifact(identity, 'blob:analytics-current'),
    identity,
    type: 'operation-completed',
  });
  expect(presented.effects).toContainEqual({
    identity,
    reason: 'buffered-analytics-presented',
    receiptId: 1,
    type: 'publish-analytics',
  });
  expect(presented.state.analytics).toEqual({ identity, status: 'presented' });
  expect(presented.state.pendingAnalytics).toEqual([]);

  const duplicate = transition(presented.state, { identity, receiptId: 2, type: 'analytics-result-received' });
  expect(duplicate.effects).toEqual([
    { reason: 'duplicate-analytics-result', receiptId: 2, type: 'discard-analytics' },
  ]);
});

test('analytics rejects A to B to successor-A reordering and keeps bounded transition receipts', () => {
  let state = createPreviewCoordinatorState();
  const firstA = transition(state, {
    identity: session({ sourceImagePath: '/fixtures/a.raw' }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  const firstIdentity = required(firstA.state.settled.identity);
  state = transition(firstA.state, { identity: firstIdentity, type: 'operation-started' }).state;
  state = transition(state, { identity: firstIdentity, receiptId: 1, type: 'analytics-result-received' }).state;
  const b = session({ imageSessionId: 2, sourceImagePath: '/fixtures/b.raw', sourceRevision: 2 });
  const switched = transition(state, { session: b, type: 'image-session-installed' });
  expect(switched.effects).toContainEqual({
    reason: 'image-session-replaced',
    receiptId: 1,
    type: 'discard-analytics',
  });

  const successor = transition(switched.state, {
    identity: session({ imageSessionId: 3, sourceImagePath: '/fixtures/a.raw', sourceRevision: 3 }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  const successorIdentity = required(successor.state.settled.identity);
  const stale = transition(successor.state, {
    identity: firstIdentity,
    receiptId: 2,
    type: 'analytics-result-received',
  });
  expect(stale.effects).toEqual([{ reason: 'stale-analytics-result', receiptId: 2, type: 'discard-analytics' }]);

  state = stale.state;
  for (let receiptId = 3; receiptId <= 40; receiptId += 1) {
    state = transition(state, { identity: firstIdentity, receiptId, type: 'analytics-result-received' }).state;
  }
  expect(state.analyticsTransitions).toHaveLength(32);
  expect(state.analyticsTransitions.at(-1)).toMatchObject({ action: 'discarded', receiptId: 40 });

  state = transition(state, { identity: successorIdentity, type: 'operation-started' }).state;
  const current = transition(state, {
    identity: successorIdentity,
    receiptId: 41,
    type: 'analytics-result-received',
  });
  expect(current.state.pendingAnalytics).toEqual([{ identity: successorIdentity, receiptId: 41 }]);
});

test('new render inputs cancel the previous operation and start newest work', () => {
  let state = createPreviewCoordinatorState();
  state = transition(state, { type: 'image-session-installed', session: session() }).state;
  const first = transition(state, { kind: 'interactive', type: 'render-inputs-changed', identity: session() });
  state = first.state;
  expect(first.effects).toEqual([
    { type: 'start', identity: state.interactive.identity, reason: 'render-inputs-changed' },
  ]);
  state = transition(state, { type: 'operation-started', identity: state.interactive.identity! }).state;
  const second = transition(state, {
    identity: session({ adjustmentRevision: 2 }),
    kind: 'interactive',
    reason: 'slider-updated',
    type: 'render-inputs-changed',
  });
  expect(second.effects).toEqual([
    { type: 'cancel', identity: first.state.interactive.identity, reason: 'newer-render-inputs' },
    { type: 'start', identity: second.state.interactive.identity, reason: 'slider-updated' },
  ]);
  expect(second.state.interactive.status).toBe('queued');
});

test('session coordinator drops bound work across A to B to A and same-session revision supersession', () => {
  const coordinator = new PreviewCoordinator();
  const firstA = session({ imageSessionId: 1, sourceImagePath: 'fixtures/a.arw', sourceRevision: 1 });
  const b = session({ imageSessionId: 2, sourceImagePath: 'fixtures/b.arw', sourceRevision: 2 });
  const secondA = session({ imageSessionId: 3, sourceImagePath: 'fixtures/a.arw', sourceRevision: 3 });

  const first = coordinator.dispatch({ identity: firstA, kind: 'settled', type: 'render-inputs-changed' });
  const firstIdentity = required(first.state.settled.identity);
  expect(coordinator.bindRequest(41, firstIdentity)).toBe(true);
  coordinator.dispatch({ identity: firstIdentity, type: 'operation-started' });
  coordinator.dispatch({ session: b, type: 'image-session-installed' });
  expect(coordinator.operationForRequest(41)).toBeUndefined();

  const returned = coordinator.dispatch({ identity: secondA, kind: 'settled', type: 'render-inputs-changed' });
  const returnedIdentity = required(returned.state.settled.identity);
  expect(returnedIdentity.operationId).toBeGreaterThan(firstIdentity.operationId);
  expect(coordinator.bindRequest(42, returnedIdentity)).toBe(true);
  coordinator.dispatch({ identity: returnedIdentity, type: 'operation-started' });

  const proposedGraphRevision = fingerprintPreviewGraphRevision({
    adjustmentRevision: secondA.adjustmentRevision,
    geometryRevision: secondA.geometryRevision,
    imageSessionId: secondA.imageSessionId,
    maskRevision: secondA.maskRevision,
    patchRevision: secondA.patchRevision,
    proofRevision: secondA.proofRevision,
    proposalFingerprint: 'reference-match:proposal-2',
  });
  const proposal = coordinator.dispatch({
    identity: { ...secondA, graphRevision: proposedGraphRevision },
    kind: 'settled',
    reason: 'proposal-replaced',
    type: 'render-inputs-changed',
  });
  const proposalIdentity = required(proposal.state.settled.identity);
  expect(coordinator.operationForRequest(42)).toBeUndefined();
  expect(coordinator.bindRequest(43, proposalIdentity)).toBe(true);

  const stale = coordinator.dispatch({
    artifact: artifact(returnedIdentity, 'blob:stale-returned-a'),
    identity: returnedIdentity,
    type: 'operation-completed',
  });
  expect(stale.state.staleCompletionCount).toBe(1);
  expect(stale.state.visibleArtifact).toBeNull();
  expect(coordinator.operationForRequest(43)).toEqual(proposalIdentity);
  expect(coordinator.snapshot().session?.graphRevision).toBe(proposedGraphRevision);
});

test('late completion is rejected after A to B to A navigation', () => {
  let state = createPreviewCoordinatorState();
  const a = session({ sourceImagePath: 'private-fixtures/a.arw' });
  const b = session({ imageSessionId: 2, sourceImagePath: 'private-fixtures/b.arw' });
  const first = transition(state, { identity: a, kind: 'settled', type: 'render-inputs-changed' });
  state = transition(first.state, { type: 'operation-started', identity: first.state.settled.identity! }).state;
  state = transition(state, { type: 'image-session-installed', session: b }).state;
  const second = transition(state, { identity: a, kind: 'settled', type: 'render-inputs-changed' });
  const late = transition(second.state, {
    artifact: artifact(first.state.settled.identity!, 'blob:stale-a'),
    identity: first.state.settled.identity!,
    type: 'operation-completed',
  });
  expect(late.state.staleCompletionCount).toBe(1);
  expect(late.state.visibleArtifact).toBeNull();
  expect(
    fingerprintPreviewOperationIdentity(
      late.state.lastTransition ? first.state.settled.identity! : second.state.settled.identity!,
    ),
  ).toBe(fingerprintPreviewOperationIdentity(first.state.settled.identity!));
});

test('settled completion wins over a late interactive result and releases replaced URLs once', () => {
  let state = createPreviewCoordinatorState();
  const installed = transition(state, { type: 'image-session-installed', session: session() });
  state = installed.state;
  const interactive = transition(state, {
    identity: session({ adjustmentRevision: 2 }),
    kind: 'interactive',
    type: 'render-inputs-changed',
  });
  state = transition(interactive.state, {
    type: 'operation-started',
    identity: interactive.state.interactive.identity!,
  }).state;
  const settled = transition(state, {
    identity: session({ adjustmentRevision: 2 }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  state = transition(settled.state, { type: 'operation-started', identity: settled.state.settled.identity! }).state;
  const settledDone = transition(state, {
    artifact: artifact(settled.state.settled.identity!, 'blob:settled'),
    identity: settled.state.settled.identity!,
    type: 'operation-completed',
  });
  expect(settledDone.effects).toContainEqual({
    type: 'cancel',
    identity: interactive.state.interactive.identity,
    reason: 'settled-operation-presented',
  });
  expect(settledDone.effects).toContainEqual({
    type: 'present',
    identity: settled.state.settled.identity,
    reason: 'operation-presented',
  });
  expect(settledDone.effects).toContainEqual({
    type: 'publish',
    artifact: { identity: settled.state.settled.identity, url: 'blob:settled' },
    identity: settled.state.settled.identity,
    reason: 'operation-presented',
  });
  state = settledDone.state;
  const interactiveDone = transition(state, {
    artifact: artifact(interactive.state.interactive.identity!, 'blob:interactive'),
    identity: interactive.state.interactive.identity!,
    type: 'operation-completed',
  });
  expect(interactiveDone.state.visibleArtifact?.url).toBe('blob:settled');
  expect(interactiveDone.effects).toEqual([
    { type: 'release-url', url: 'blob:interactive', reason: 'artifact-not-presented' },
  ]);

  const replacementQueued = transition(interactiveDone.state, {
    identity: session({ adjustmentRevision: 2, viewportRevision: 2 }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  const replacementRunning = transition(replacementQueued.state, {
    identity: replacementQueued.state.settled.identity!,
    type: 'operation-started',
  }).state;
  const replacement = transition(replacementRunning, {
    artifact: artifact(replacementRunning.settled.identity!, 'blob:new-settled'),
    identity: replacementRunning.settled.identity!,
    type: 'operation-completed',
  });
  expect(replacement.effects).toContainEqual({ type: 'release-url', url: 'blob:settled', reason: 'artifact-replaced' });
});

test('session cancellation releases the visible URL and prevents further publication', () => {
  let state = createPreviewCoordinatorState();
  const started = transition(state, { identity: session(), kind: 'original', type: 'render-inputs-changed' });
  state = transition(started.state, { type: 'operation-started', identity: started.state.original.identity! }).state;
  const done = transition(state, {
    artifact: artifact(started.state.original.identity!, 'blob:original'),
    identity: started.state.original.identity!,
    type: 'operation-completed',
  });
  const cancelled = transition(done.state, { reason: 'editor-unmounted', type: 'cancel-session' });
  expect(cancelled.effects).toEqual([{ type: 'release-url', url: 'blob:original', reason: 'editor-unmounted' }]);
  expect(cancelled.state.session).toBeNull();
  expect(cancelled.state.originalArtifact).toBeNull();
  expect(cancelled.state.visibleArtifact).toBeNull();
});

test('original compare publishes independently without replacing the edited artifact', () => {
  const coordinator = new PreviewCoordinator();
  const edited = coordinator.dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
  const editedIdentity = required(edited.state.settled.identity);
  coordinator.dispatch({ identity: editedIdentity, type: 'operation-started' });
  coordinator.dispatch({
    artifact: artifact(editedIdentity, 'blob:edited'),
    identity: editedIdentity,
    type: 'operation-completed',
  });

  const original = coordinator.dispatch({ identity: session(), kind: 'original', type: 'render-inputs-changed' });
  const originalIdentity = required(original.state.original.identity);
  coordinator.dispatch({ identity: originalIdentity, type: 'operation-started' });
  const completed = coordinator.dispatch({
    artifact: artifact(originalIdentity, 'blob:original'),
    identity: originalIdentity,
    type: 'operation-completed',
  });

  expect(completed.effects).toEqual([
    {
      artifact: artifact(originalIdentity, 'blob:original'),
      identity: originalIdentity,
      reason: 'operation-presented',
      type: 'publish',
    },
  ]);
  expect(completed.state.visibleArtifact?.url).toBe('blob:edited');
  expect(completed.state.originalArtifact?.url).toBe('blob:original');

  const cancelled = coordinator.dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });
  expect(cancelled.effects).toEqual([
    { reason: 'editor-unmounted', type: 'release-url', url: 'blob:edited' },
    { reason: 'editor-unmounted', type: 'release-url', url: 'blob:original' },
    { reason: 'editor-unmounted', type: 'clear-analytics' },
  ]);
});

test('newest original replaces and clear cancels only the compare channel with exact URL release', () => {
  const coordinator = new PreviewCoordinator();
  const first = coordinator.dispatch({ identity: session(), kind: 'original', type: 'render-inputs-changed' });
  const firstIdentity = required(first.state.original.identity);
  coordinator.dispatch({ identity: firstIdentity, type: 'operation-started' });
  coordinator.dispatch({
    artifact: artifact(firstIdentity, 'blob:original-1'),
    identity: firstIdentity,
    type: 'operation-completed',
  });

  const second = coordinator.dispatch({
    identity: session({ targetHeight: 1400, targetWidth: 2200, viewportRevision: 2 }),
    kind: 'original',
    type: 'render-inputs-changed',
  });
  const secondIdentity = required(second.state.original.identity);
  coordinator.dispatch({ identity: secondIdentity, type: 'operation-started' });
  const completed = coordinator.dispatch({
    artifact: artifact(secondIdentity, 'blob:original-2'),
    identity: secondIdentity,
    type: 'operation-completed',
  });
  expect(completed.effects).toContainEqual({
    reason: 'original-artifact-replaced',
    type: 'release-url',
    url: 'blob:original-1',
  });
  expect(completed.state.originalArtifact?.url).toBe('blob:original-2');

  const third = coordinator.dispatch({
    identity: session({ targetHeight: 1600, targetWidth: 2400, viewportRevision: 3 }),
    kind: 'original',
    type: 'render-inputs-changed',
  });
  const thirdIdentity = required(third.state.original.identity);
  const cleared = coordinator.dispatch({ reason: 'compare-disabled', type: 'original-preview-cleared' });
  expect(cleared.effects).toEqual([
    { identity: thirdIdentity, reason: 'compare-disabled', type: 'cancel' },
    { reason: 'compare-disabled', type: 'release-url', url: 'blob:original-2' },
  ]);
  expect(cleared.state.original).toEqual({ status: 'idle' });
  expect(cleared.state.originalArtifact).toBeNull();
});

test('original compare completion is rejected when a newer viewport request supersedes it', () => {
  let state = createPreviewCoordinatorState();
  const first = transition(state, {
    identity: session({ viewportRevision: 1 }),
    kind: 'original',
    type: 'render-inputs-changed',
  });
  state = transition(first.state, { identity: first.state.original.identity!, type: 'operation-started' }).state;
  const newer = transition(state, {
    identity: session({ targetWidth: 2200, targetHeight: 1400, viewportRevision: 2 }),
    kind: 'original',
    type: 'render-inputs-changed',
  });
  const late = transition(newer.state, {
    artifact: artifact(first.state.original.identity!, 'blob:stale-original'),
    identity: first.state.original.identity!,
    type: 'operation-completed',
  });
  expect(late.state.staleCompletionCount).toBe(1);
  expect(late.state.visibleArtifact).toBeNull();
  expect(late.state.originalArtifact).toBeNull();
  expect(late.effects).toEqual([
    { reason: 'stale-original-artifact', type: 'release-url', url: 'blob:stale-original' },
  ]);
});

test('viewport changes cancel active work and retain one canonical ROI snapshot', () => {
  let state = createPreviewCoordinatorState();
  const started = transition(state, { identity: session(), kind: 'settled', type: 'render-inputs-changed' });
  state = transition(started.state, { identity: started.state.settled.identity!, type: 'operation-started' }).state;
  const viewport = transition(state, {
    type: 'viewport-changed',
    viewport: { revision: 2, roiFingerprint: '[0.1,0.1,0.8,0.8]', targetHeight: 900, targetWidth: 1600 },
  });
  expect(viewport.effects).toContainEqual({
    type: 'cancel',
    identity: started.state.settled.identity,
    reason: 'viewport-changed',
  });
  expect(viewport.state.viewport).toEqual({
    revision: 2,
    roiFingerprint: '[0.1,0.1,0.8,0.8]',
    targetHeight: 900,
    targetWidth: 1600,
  });
  const unchanged = transition(viewport.state, {
    type: 'viewport-changed',
    viewport: { revision: 2, roiFingerprint: '[0.1,0.1,0.8,0.8]', targetHeight: 900, targetWidth: 1600 },
  });
  expect(unchanged.effects).toEqual([]);
});

test('viewport transitions retain the last canonical pixels and reject the cancelled completion', () => {
  let state = createPreviewCoordinatorState();
  state = transition(state, { session: session(), type: 'image-session-installed' }).state;

  const base = transition(state, { identity: session(), kind: 'settled', type: 'render-inputs-changed' });
  state = transition(base.state, { identity: base.state.settled.identity!, type: 'operation-started' }).state;
  state = transition(state, {
    artifact: artifact(base.state.settled.identity!, 'blob:canonical-base'),
    identity: base.state.settled.identity!,
    type: 'operation-completed',
  }).state;

  const successor = transition(state, {
    identity: session({ targetHeight: 1400, targetWidth: 2200, viewportRevision: 2 }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  state = transition(successor.state, {
    identity: successor.state.settled.identity!,
    type: 'operation-started',
  }).state;
  const viewport = transition(state, {
    type: 'viewport-changed',
    viewport: { revision: 3, roiFingerprint: '[0.2,0.1,0.5,0.5]', targetHeight: 1600, targetWidth: 2400 },
  });

  expect(viewport.state.visibleArtifact?.url).toBe('blob:canonical-base');
  expect(viewport.effects).toEqual([
    { type: 'cancel', identity: successor.state.settled.identity, reason: 'viewport-changed' },
  ]);

  const late = transition(viewport.state, {
    artifact: artifact(successor.state.settled.identity!, 'blob:cancelled-successor'),
    identity: successor.state.settled.identity!,
    type: 'operation-completed',
  });
  expect(late.state.visibleArtifact?.url).toBe('blob:canonical-base');
  expect(late.state.staleCompletionCount).toBe(1);
  expect(late.effects).toEqual([
    { reason: 'artifact-not-presented', type: 'release-url', url: 'blob:cancelled-successor' },
  ]);
});

test('display generation accepts only newer identities and releases reordered completions exactly once', () => {
  let state = createPreviewCoordinatorState();
  const started = transition(state, { identity: session(), kind: 'settled', type: 'render-inputs-changed' });
  state = transition(started.state, { type: 'operation-started', identity: started.state.settled.identity! }).state;
  state = transition(state, {
    artifact: artifact(started.state.settled.identity!, 'blob:display-old'),
    identity: started.state.settled.identity!,
    type: 'operation-completed',
  }).state;
  const replacement = transition(state, {
    identity: session({ adjustmentRevision: 2 }),
    kind: 'settled',
    type: 'render-inputs-changed',
  });
  state = transition(replacement.state, {
    identity: replacement.state.settled.identity!,
    type: 'operation-started',
  }).state;

  const invalidated = transition(state, { generation: 3, type: 'display-generation-changed' });
  expect(invalidated.effects).toEqual([
    {
      identity: replacement.state.settled.identity,
      reason: 'display-generation-changed',
      type: 'cancel',
    },
    {
      reason: 'display-generation-changed',
      type: 'release-url',
      url: 'blob:display-old',
    },
    { reason: 'display-generation-changed', type: 'clear-analytics' },
  ]);
  expect(invalidated.state.visibleArtifact).toBeNull();
  expect(invalidated.state.displayGeneration).toBe(3);

  const reordered = transition(invalidated.state, { generation: 2, type: 'display-generation-changed' });
  expect(reordered.effects).toEqual([]);
  expect(reordered.state.displayGeneration).toBe(3);
  expect(reordered.state.lastTransition?.reason).toBe('display-generation-stale');

  const late = transition(reordered.state, {
    artifact: artifact(replacement.state.settled.identity!, 'blob:display-late'),
    identity: replacement.state.settled.identity!,
    type: 'operation-completed',
  });
  expect(late.effects).toEqual([{ reason: 'artifact-not-presented', type: 'release-url', url: 'blob:display-late' }]);
  expect(late.state.visibleArtifact).toBeNull();
  expect(late.state.staleCompletionCount).toBe(1);

  const duplicate = transition(late.state, { generation: 3, type: 'display-generation-changed' });
  expect(duplicate.effects).toEqual([]);
  expect(duplicate.state.displayGeneration).toBe(3);
  expect(duplicate.state.staleCompletionCount).toBe(1);
});

test('quality decisions are translated once and ROI fingerprints are resolution-stable', () => {
  expect(quantizePreviewRoi([0.1234, 0.5678, 0.25, 0.125], 100)).toEqual([0.12, 0.57, 0.25, 0.13]);
  expect(fingerprintPreviewRoi(null)).toBe('[0,0,1,1]');
  expect(fingerprintPreviewRoi([0.1, 0.1, 0.8, 0.8])).toBe(fingerprintPreviewRoi([0.1, 0.1, 0.8, 0.8]));
  expect(fingerprintPreviewRoi([0.1, 0.1, 0.8, 0.8])).not.toBe(fingerprintPreviewRoi([0.15, 0.1, 0.8, 0.8]));
  const quality = {
    effectiveTargetResolution: 1600,
    interacting: false,
    reason: 'settled viewport',
    requestedTargetResolution: 1800,
    roiFingerprint: fingerprintPreviewRoi([0.1, 0.1, 0.8, 0.8]),
    sufficientForSemanticZoom: true,
    tier: 'settled_full',
  } as const;
  const transition = reducePreviewCoordinator(createPreviewCoordinatorState(), {
    quality,
    type: 'quality-decision-changed',
  });
  expect(transition.state.quality).toEqual(quality);
  expect(transition.state.lastTransition?.reason).toBe('quality-decision-changed');
});

test('settled viewport transforms derive exact bounded ROI snapshots without a UI controller', () => {
  const layout = {
    containerHeight: 600,
    containerWidth: 800,
    height: 600,
    offsetX: 0,
    offsetY: 0,
    width: 800,
  };
  expect(resolvePreviewViewportRoi(layout, { positionX: 0, positionY: 0, scale: 1 })).toBeNull();
  expect(resolvePreviewViewportRoi(layout, { positionX: -400, positionY: -300, scale: 2 })).toEqual([
    0.25, 0.25, 0.5, 0.5,
  ]);
  expect(resolvePreviewViewportRoi(layout, { positionX: -200, positionY: -120, scale: 2 })).toEqual([
    0.125, 0.1, 0.5, 0.5,
  ]);
  expect(resolvePreviewViewportRoi(layout, { positionX: 2000, positionY: 2000, scale: 2 })).toBeNull();
  expect(resolvePreviewViewportRoi(layout, { positionX: Number.NaN, positionY: 0, scale: 2 })).toBeNull();
});

test('quality policy construction stays coordinator-owned and preserves adaptive state', () => {
  const policy = createPreviewQualityPolicy();
  policy.noteInput(100);
  policy.noteInput(116);
  const decision = policy.decide({
    backend: 'wgpu',
    devicePixelRatio: 2,
    interacting: false,
    operationClass: 'standard',
    requestedTargetResolution: 1600,
    semanticZoom: 'viewport',
    sourceHeight: 2400,
    sourceWidth: 3600,
    visibleRoi: null,
  });
  expect(decision.tier).toBe('viewport_full');
  expect(decision.effectiveTargetResolution).toBeGreaterThan(0);
  policy.reset();
  expect(policy.metrics()).toEqual([]);
});
