import { describe, expect, test } from 'bun:test';

import {
  PreviewCoordinator,
  type PreviewCoordinatorEffect,
  type PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';
import {
  type PreviewViewportAuthorityInput,
  PreviewViewportSnapshotController,
} from '../../../src/utils/previewViewportSnapshot';

const baseInput = (): PreviewViewportAuthorityInput => ({
  devicePixelRatio: 2,
  geometryRevision: 4,
  layout: {
    containerHeight: 800,
    containerWidth: 1200,
    height: 800,
    offsetX: 0,
    offsetY: 0,
    width: 1200,
  },
  qualityPolicy: {
    editorPreviewResolution: 1920,
    enableZoomHifi: true,
    highResZoomMultiplier: 1,
    useFullDpiRendering: false,
  },
  roi: [0.1, 0.2, 0.5, 0.6],
  sourceImagePath: '/fixtures/a.raw',
  sourceRevision: 7,
  targetHeight: 800,
  targetWidth: 1200,
  transform: { positionX: -120, positionY: -80, scale: 2 },
  zoomMode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
});

const session = (viewport: ReturnType<PreviewViewportSnapshotController['snapshot']>): PreviewSessionIdentity => ({
  adjustmentRevision: 1,
  backend: 'cpu',
  displayGeneration: 1,
  geometryRevision: viewport.input.geometryRevision,
  graphRevision: 'graph-a',
  imageSessionId: viewport.input.sourceRevision,
  maskRevision: 0,
  patchRevision: 0,
  proofRevision: 0,
  roiFingerprint: viewport.coordinator.roiFingerprint,
  sourceImagePath: viewport.input.sourceImagePath,
  sourceRevision: viewport.input.sourceRevision,
  targetHeight: viewport.coordinator.targetHeight,
  targetWidth: viewport.coordinator.targetWidth,
  viewportRevision: viewport.coordinator.revision,
});

const publishedValues = (effects: readonly PreviewCoordinatorEffect[]): string[] =>
  effects.flatMap((effect) => (effect.type === 'publish' ? [effect.artifact.url] : []));

const scheduledIdentity = (effects: readonly PreviewCoordinatorEffect[]) => {
  const start = effects.find((effect) => effect.type === 'start');
  if (start?.type !== 'start') throw new Error('Expected a scheduled preview operation.');
  return start.identity;
};

describe('preview viewport snapshot controller', () => {
  test('returns one immutable causal snapshot for unchanged canonical inputs', () => {
    const controller = new PreviewViewportSnapshotController();
    const input = baseInput();
    const first = controller.snapshot(input);
    const cloned = controller.snapshot(structuredClone(input));

    expect(cloned).toBe(first);
    expect(cloned.coordinator.revision).toBe(1);
    expect(Object.isFrozen(cloned)).toBeTrue();
    expect(Object.isFrozen(cloned.input.layout)).toBeTrue();
    expect(Object.isFrozen(cloned.input.qualityPolicy)).toBeTrue();
    expect(Object.isFrozen(cloned.input.transform)).toBeTrue();
    expect(Object.isFrozen(cloned.input.zoomMode)).toBeTrue();
    expect(Object.isFrozen(cloned.roi)).toBeTrue();
    expect(cloned.input.roi).toEqual(cloned.roi);
    expect(controller.current()).toBe(first);
  });

  test('uses exact source, geometry, zoom, DPR, target, layout, transform, and quantized ROI identity', () => {
    const mutations: Array<(input: PreviewViewportAuthorityInput) => PreviewViewportAuthorityInput> = [
      (input) => ({ ...input, sourceImagePath: '/fixtures/b.raw' }),
      (input) => ({ ...input, sourceRevision: input.sourceRevision + 1 }),
      (input) => ({ ...input, geometryRevision: input.geometryRevision + 1 }),
      (input) => ({ ...input, zoomMode: { kind: 'fill' } }),
      (input) => ({ ...input, devicePixelRatio: 1.5 }),
      (input) => ({ ...input, targetWidth: input.targetWidth + 1 }),
      (input) => ({ ...input, targetHeight: input.targetHeight + 1 }),
      (input) => ({
        ...input,
        qualityPolicy: { ...input.qualityPolicy, editorPreviewResolution: 2048 },
      }),
      (input) => ({
        ...input,
        qualityPolicy: { ...input.qualityPolicy, enableZoomHifi: false },
      }),
      (input) => ({
        ...input,
        qualityPolicy: { ...input.qualityPolicy, highResZoomMultiplier: 1.5 },
      }),
      (input) => ({
        ...input,
        qualityPolicy: { ...input.qualityPolicy, useFullDpiRendering: true },
      }),
      (input) => ({ ...input, layout: { ...input.layout, offsetX: input.layout.offsetX + 0.25 } }),
      (input) => ({ ...input, transform: { ...input.transform, positionX: input.transform.positionX + 0.25 } }),
      (input) => ({ ...input, roi: [0.11, 0.2, 0.5, 0.6] }),
    ];

    for (const mutate of mutations) {
      const controller = new PreviewViewportSnapshotController();
      const first = controller.snapshot(baseInput());
      const second = controller.snapshot(mutate(baseInput()));
      expect(second.coordinator.revision).toBe(first.coordinator.revision + 1);
      expect(second.fingerprint).not.toBe(first.fingerprint);
    }

    const quantized = new PreviewViewportSnapshotController();
    const first = quantized.snapshot(baseInput());
    const belowOnePixel = quantized.snapshot({
      ...baseInput(),
      roi: [0.1 + 0.2 / 1200, 0.2, 0.5, 0.6],
    });
    expect(belowOnePixel).toBe(first);
  });

  test('A to B to A creates a successor identity and rejects reordered stale completion', () => {
    const controller = new PreviewViewportSnapshotController();
    const coordinator = new PreviewCoordinator();
    const a = baseInput();
    const b = { ...baseInput(), transform: { ...baseInput().transform, positionX: -240 } };
    const firstA = controller.snapshot(a);
    const viewportB = controller.snapshot(b);
    const successorA = controller.snapshot(a);

    expect([firstA.coordinator.revision, viewportB.coordinator.revision, successorA.coordinator.revision]).toEqual([
      1, 2, 3,
    ]);
    expect(successorA.fingerprint).toBe(firstA.fingerprint);
    expect(successorA).not.toBe(firstA);

    coordinator.dispatch({ type: 'viewport-changed', viewport: firstA.coordinator });
    const firstAIdentity = scheduledIdentity(
      coordinator.dispatch({ identity: session(firstA), kind: 'settled', type: 'render-inputs-changed' }).effects,
    );
    coordinator.dispatch({ identity: firstAIdentity, type: 'operation-started' });

    coordinator.dispatch({ type: 'viewport-changed', viewport: viewportB.coordinator });
    const bIdentity = scheduledIdentity(
      coordinator.dispatch({ identity: session(viewportB), kind: 'settled', type: 'render-inputs-changed' }).effects,
    );
    coordinator.dispatch({ identity: bIdentity, type: 'operation-started' });

    coordinator.dispatch({ type: 'viewport-changed', viewport: successorA.coordinator });
    const successorIdentity = scheduledIdentity(
      coordinator.dispatch({ identity: session(successorA), kind: 'settled', type: 'render-inputs-changed' }).effects,
    );
    coordinator.dispatch({ identity: successorIdentity, type: 'operation-started' });

    const staleA = coordinator.dispatch({
      artifact: { identity: firstAIdentity, url: 'blob:first-a' },
      identity: firstAIdentity,
      type: 'operation-completed',
    });
    const staleB = coordinator.dispatch({
      artifact: { identity: bIdentity, url: 'blob:b' },
      identity: bIdentity,
      type: 'operation-completed',
    });
    const currentA = coordinator.dispatch({
      artifact: { identity: successorIdentity, url: 'blob:successor-a' },
      identity: successorIdentity,
      type: 'operation-completed',
    });

    expect(staleA.state.lastTransition?.staleCompletion).toBeTrue();
    expect(staleB.state.lastTransition?.staleCompletion).toBeTrue();
    expect(publishedValues(staleA.effects)).toEqual([]);
    expect(publishedValues(staleB.effects)).toEqual([]);
    expect(publishedValues(currentA.effects)).toEqual(['blob:successor-a']);
  });
});
