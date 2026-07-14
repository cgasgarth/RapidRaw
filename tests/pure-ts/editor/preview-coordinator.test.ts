import {
  createPreviewCoordinatorState,
  fingerprintPreviewOperationIdentity,
  fingerprintPreviewSessionIdentity,
  type PreviewArtifact,
  type PreviewSessionIdentity,
  reducePreviewCoordinator,
} from '../../../src/utils/previewCoordinator';

const session = (overrides: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => ({
  adjustmentRevision: 1,
  backend: 'wgpu',
  displayGeneration: 1,
  geometryRevision: 1,
  imageSessionId: 1,
  maskRevision: 1,
  patchRevision: 1,
  proofRevision: 1,
  roiFingerprint: 'full',
  sourceImagePath: 'private-fixtures/landscape.arw',
  sourceRevision: 1,
  targetHeight: 1000,
  targetWidth: 1600,
  viewportRevision: 1,
  ...overrides,
});

const artifact = (identity: PreviewArtifact['identity'], url: string): PreviewArtifact => ({ identity, url });

function transition(
  state: ReturnType<typeof createPreviewCoordinatorState>,
  event: Parameters<typeof reducePreviewCoordinator>[1],
) {
  return reducePreviewCoordinator(state, event);
}

test('fingerprints are canonical and distinguish typed source identity changes', () => {
  expect(fingerprintPreviewSessionIdentity(session())).toBe(fingerprintPreviewSessionIdentity(session()));
  expect(fingerprintPreviewSessionIdentity(session())).not.toBe(
    fingerprintPreviewSessionIdentity(session({ sourceRevision: 2 })),
  );
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
  state = settledDone.state;
  const interactiveDone = transition(state, {
    artifact: artifact(interactive.state.interactive.identity!, 'blob:interactive'),
    identity: interactive.state.interactive.identity!,
    type: 'operation-completed',
  });
  expect(interactiveDone.state.visibleArtifact?.url).toBe('blob:settled');
  expect(interactiveDone.effects).toEqual([]);

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
  expect(cancelled.state.visibleArtifact).toBeNull();
});
