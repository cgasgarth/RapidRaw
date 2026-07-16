import { describe, expect, test } from 'bun:test';

import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import type { PreviewOperationIdentity } from '../../../src/utils/previewCoordinator';
import { PreviewCoordinatorRuntime, type PreviewSurfaceUpdate } from '../../../src/utils/previewCoordinatorRuntime';
import { PreviewOriginalCompareAdapter } from '../../../src/utils/previewOriginalCompareAdapter';
import {
  PreviewRequestScopeAdapter,
  type PreviewRequestScopeInput,
} from '../../../src/utils/previewRequestScopeAdapter';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};

const source = (path: string, imageSessionId: number, proofRevision = 1, exposure = 0): PreviewRequestScopeInput => {
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
    exposure,
  });
  const adjustmentSnapshot = publishAdjustmentSnapshot(null, editDocumentV2);
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
    proofRevision,
    referenceMatchPreview: null,
    selectedImage: { isReady: true, path, thumbnailUrl: `blob:thumb:${path}` },
    settings: { editorPreviewResolution: 1200, enableZoomHifi: true, useWgpuRenderer: false },
    zoomMode: { kind: 'fit' },
  };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const requiredIdentity = (identity: PreviewOperationIdentity | undefined): PreviewOperationIdentity => {
  if (identity === undefined) throw new Error('Expected original operation identity.');
  return identity;
};

describe('preview original compare adapter', () => {
  test('captures an immutable original request only while compare is active', () => {
    const runtime = new PreviewCoordinatorRuntime({ publishSurface: () => undefined });
    const scopeAdapter = new PreviewRequestScopeAdapter({
      getDisplayGeneration: () => runtime.snapshot().displayGeneration,
    });
    const adapter = new PreviewOriginalCompareAdapter({ dispatch: runtime.dispatch });
    const currentSource = source('/fixtures/a.raw', 1, 3, 1.25);
    let captures = 0;
    const capture = (targetResolution: number) => {
      captures += 1;
      return scopeAdapter.capture(currentSource, targetResolution, null, 2);
    };

    expect(adapter.capture(false, 1600, capture)).toBeNull();
    const prepared = adapter.capture(true, 1600, capture);
    if (prepared === null) throw new Error('Expected active compare capture.');

    expect(captures).toBe(1);
    expect(prepared.request).toMatchObject({
      expectedImagePath: '/fixtures/a.raw',
      editDocumentV2: { schemaVersion: 2 },
      targetResolution: 1600,
      viewerSampleGraphRevision: prepared.session.graphRevision,
    });
    expect(prepared.request.editDocumentV2).not.toBe(currentSource.adjustmentSnapshot.editDocumentV2);
    expect(selectEditDocumentNode(prepared.request.editDocumentV2, 'scene_global_color_tone').params['exposure']).toBe(
      1.25,
    );
    expect(prepared.session).toMatchObject({
      displayGeneration: 1,
      proofRevision: 3,
      roiFingerprint: '[0,0,1,1]',
      targetHeight: 1600,
      targetWidth: 1600,
    });
  });

  test('owns schedule effects and releases a reordered proof/display predecessor exactly once', async () => {
    const published: PreviewSurfaceUpdate[] = [];
    const released: string[] = [];
    let displayGeneration = 1;
    const scopeAdapter = new PreviewRequestScopeAdapter({ getDisplayGeneration: () => displayGeneration });
    const first = deferred<string>();
    const successor = deferred<string>();
    const executions = [first.promise, successor.promise];
    const runtime = new PreviewCoordinatorRuntime({
      publishSurface: (update) => published.push(update),
      releaseUrl: (url) => released.push(url),
    });
    const adapter = new PreviewOriginalCompareAdapter({
      dispatch: runtime.dispatch,
      execute: () => executions.shift() ?? Promise.reject(new Error('Unexpected original execution.')),
    });
    runtime.installEffectConsumers([(effects) => adapter.consume(effects)]);
    const prepare = (input: PreviewRequestScopeInput) =>
      adapter.capture(true, 1200, (targetResolution) => scopeAdapter.capture(input, targetResolution, null, 1));
    const firstPrepared = prepare(source('/fixtures/a.raw', 1, 1));
    if (firstPrepared === null) throw new Error('Expected first original request.');

    adapter.consume([{ delayMs: 0, prepared: firstPrepared, reason: 'compare-enabled', type: 'schedule-original' }]);
    const firstIdentity = requiredIdentity(runtime.snapshot().original.identity);
    await tick();
    displayGeneration = 2;
    const successorPrepared = prepare(source('/fixtures/a.raw', 1, 2));
    if (successorPrepared === null) throw new Error('Expected successor original request.');
    adapter.consume([
      { delayMs: 0, prepared: successorPrepared, reason: 'proof-display-changed', type: 'schedule-original' },
    ]);
    await tick();

    first.resolve('blob:stale-original');
    await tick();
    successor.resolve('blob:current-original');
    await tick();
    runtime.dispatch({
      artifact: { identity: firstIdentity, url: 'blob:stale-original' },
      identity: firstIdentity,
      type: 'operation-completed',
    });

    expect(runtime.snapshot().originalArtifact).toMatchObject({
      identity: { session: { displayGeneration: 2, proofRevision: 2 } },
      url: 'blob:current-original',
    });
    expect(published).toEqual([{ transformedOriginalUrl: 'blob:current-original' }]);
    expect(released).toEqual(['blob:stale-original']);
  });

  test('compare disable cancels queued native work without replacing the edited surface', async () => {
    const published: PreviewSurfaceUpdate[] = [];
    let executions = 0;
    const runtime = new PreviewCoordinatorRuntime({ publishSurface: (update) => published.push(update) });
    const adapter = new PreviewOriginalCompareAdapter({
      dispatch: runtime.dispatch,
      execute: async () => {
        executions += 1;
        return 'blob:unexpected-original';
      },
    });
    runtime.installEffectConsumers([(effects) => adapter.consume(effects)]);
    const scopeAdapter = new PreviewRequestScopeAdapter({
      getDisplayGeneration: () => runtime.snapshot().displayGeneration,
    });
    const prepared = adapter.capture(true, 1200, (targetResolution) =>
      scopeAdapter.capture(source('/fixtures/a.raw', 1), targetResolution, null, 1),
    );
    if (prepared === null) throw new Error('Expected queued original request.');

    adapter.consume([{ delayMs: 25, prepared, reason: 'compare-enabled', type: 'schedule-original' }]);
    runtime.dispatch({ reason: 'compare-disabled', type: 'original-preview-cleared' });
    await new Promise((resolve) => setTimeout(resolve, 35));

    expect(executions).toBe(0);
    expect(runtime.snapshot().originalArtifact).toBeNull();
    expect(runtime.snapshot().visibleArtifact).toBeNull();
    expect(published).toEqual([]);
  });
});
