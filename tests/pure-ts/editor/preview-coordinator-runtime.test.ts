import { describe, expect, test } from 'bun:test';
import type {
  PreviewArtifact,
  PreviewOperationIdentity,
  PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';
import { PreviewCoordinatorRuntime, type PreviewSurfaceUpdate } from '../../../src/utils/previewCoordinatorRuntime';

const session = (values: Partial<PreviewSessionIdentity> = {}): PreviewSessionIdentity => ({
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
  sourceImagePath: '/a.raw',
  sourceRevision: 1,
  targetHeight: 1024,
  targetWidth: 1024,
  viewportRevision: 0,
  ...values,
});

const requiredIdentity = (identity: PreviewOperationIdentity | undefined): PreviewOperationIdentity => {
  if (identity === undefined) throw new Error('Expected preview operation identity.');
  return identity;
};

const artifact = (identity: PreviewOperationIdentity, url: string): PreviewArtifact => ({ identity, url });

describe('preview coordinator runtime', () => {
  test('rejects reordered A-B-A completions and releases each never-presented URL exactly once', () => {
    const published: PreviewSurfaceUpdate[] = [];
    const released: string[] = [];
    const runtime = new PreviewCoordinatorRuntime({
      publishSurface: (update) => published.push(update),
      releaseUrl: (url) => released.push(url),
    });
    const start = (identity: PreviewSessionIdentity): PreviewOperationIdentity => {
      const queued = runtime.dispatch({ identity, kind: 'settled', type: 'render-inputs-changed' });
      const operation = requiredIdentity(queued.state.settled.identity);
      runtime.dispatch({ identity: operation, type: 'operation-started' });
      return operation;
    };

    const firstA = start(session());
    const imageB = start(
      session({ graphRevision: 'graph-b', imageSessionId: 2, sourceImagePath: '/b.raw', sourceRevision: 2 }),
    );
    const finalA = start(
      session({ adjustmentRevision: 2, graphRevision: 'graph-a-2', imageSessionId: 3, sourceRevision: 3 }),
    );

    runtime.dispatch({ artifact: artifact(imageB, 'blob:b-late'), identity: imageB, type: 'operation-completed' });
    runtime.dispatch({
      artifact: artifact(firstA, 'blob:a-first-late'),
      identity: firstA,
      type: 'operation-completed',
    });
    runtime.dispatch({ artifact: artifact(finalA, 'blob:a-current'), identity: finalA, type: 'operation-completed' });
    runtime.dispatch({ artifact: artifact(imageB, 'blob:b-late'), identity: imageB, type: 'operation-completed' });

    expect(runtime.snapshot().visibleArtifact).toEqual(artifact(finalA, 'blob:a-current'));
    expect(runtime.snapshot().staleCompletionCount).toBe(3);
    expect(published).toEqual([
      { finalPreviewUrl: 'blob:a-current', presentedPreviewArtifact: artifact(finalA, 'blob:a-current') },
    ]);
    expect(released).toEqual(['blob:b-late', 'blob:a-first-late']);
  });

  test('fans coordinator effects into adapters before publishing only the exact current artifact', () => {
    const order: string[] = [];
    const runtime = new PreviewCoordinatorRuntime({
      publishSurface: (update) => order.push(`surface:${update.finalPreviewUrl ?? 'none'}`),
      releaseUrl: (url) => order.push(`release:${url}`),
    });
    runtime.installEffectConsumers([
      (effects) => order.push(`adapter:${effects.map((effect) => effect.type).join(',')}`),
    ]);
    const queued = runtime.dispatch({ identity: session(), kind: 'settled', type: 'render-inputs-changed' });
    const identity = requiredIdentity(queued.state.settled.identity);
    runtime.dispatch({ identity, type: 'operation-started' });
    order.length = 0;

    runtime.dispatch({ artifact: artifact(identity, 'blob:current'), identity, type: 'operation-completed' });

    expect(order).toEqual(['adapter:present,publish', 'surface:blob:current']);
    expect(runtime.releaseUnpresentedUrl('blob:orphan')).toBe(true);
    expect(runtime.releaseUnpresentedUrl('blob:orphan')).toBe(false);
    expect(order).toEqual(['adapter:present,publish', 'surface:blob:current', 'release:blob:orphan']);
  });

  test('transfers current replacement URLs to the surface instead of revoking them in the coordinator', () => {
    const published: PreviewSurfaceUpdate[] = [];
    const released: string[] = [];
    const runtime = new PreviewCoordinatorRuntime({
      publishSurface: (update) => published.push(update),
      releaseUrl: (url) => released.push(url),
    });
    const complete = (identity: PreviewSessionIdentity, url: string): void => {
      const queued = runtime.dispatch({ identity, kind: 'settled', type: 'render-inputs-changed' });
      const operation = requiredIdentity(queued.state.settled.identity);
      runtime.dispatch({ identity: operation, type: 'operation-started' });
      runtime.dispatch({ artifact: artifact(operation, url), identity: operation, type: 'operation-completed' });
    };

    complete(session(), 'blob:first-surface');
    complete(session({ adjustmentRevision: 2, graphRevision: 'graph-a-2' }), 'blob:second-surface');
    runtime.dispatch({ reason: 'editor-unmounted', type: 'cancel-session' });

    expect(published.map((update) => update.finalPreviewUrl)).toEqual(['blob:first-surface', 'blob:second-surface']);
    expect(released).toEqual([]);
  });

  test('publishes an interactive successor when the settled artifact belongs to older exact render inputs', () => {
    const published: PreviewSurfaceUpdate[] = [];
    const released: string[] = [];
    const runtime = new PreviewCoordinatorRuntime({
      publishSurface: (update) => published.push(update),
      releaseUrl: (url) => released.push(url),
    });
    const complete = (kind: 'interactive' | 'settled', identity: PreviewSessionIdentity, url: string) => {
      const queued = runtime.dispatch({ identity, kind, type: 'render-inputs-changed' });
      const operation = requiredIdentity(queued.state[kind].identity);
      runtime.dispatch({ identity: operation, type: 'operation-started' });
      runtime.dispatch({ artifact: artifact(operation, url), identity: operation, type: 'operation-completed' });
      return operation;
    };

    const settled = complete('settled', session(), 'blob:settled-base');
    const interactive = complete(
      'interactive',
      session({ adjustmentRevision: 2, graphRevision: 'graph-interactive' }),
      'blob:interactive-successor',
    );

    expect(runtime.snapshot().visibleArtifact).toEqual(artifact(interactive, 'blob:interactive-successor'));
    expect(published).toEqual([
      { finalPreviewUrl: 'blob:settled-base', presentedPreviewArtifact: artifact(settled, 'blob:settled-base') },
      { presentedPreviewArtifact: artifact(interactive, 'blob:interactive-successor') },
    ]);
    expect(released).toEqual([]);
  });
});
