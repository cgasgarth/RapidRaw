import { describe, expect, test } from 'bun:test';

import type { ExportSoftProofTransformState, PreviewScopeStatus } from '../../../src/store/useEditorStore';
import type { PreviewQualityDecision, PreviewTimingSample } from '../../../src/utils/adaptivePreviewQuality';
import type { InteractivePreviewIdentity } from '../../../src/utils/interactivePreviewPatch';
import {
  PreviewCoordinator,
  type PreviewOperationIdentity,
  type PreviewSessionIdentity,
} from '../../../src/utils/previewCoordinator';
import {
  PreviewPresentationAdapter,
  type PreviewPresentationContext,
  type PreviewPresentationUpdate,
  type PreviewPresentationValue,
} from '../../../src/utils/previewPresentationAdapter';

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

const interactiveIdentity = (operation: PreviewOperationIdentity): InteractivePreviewIdentity => ({
  adjustmentRevision: operation.session.adjustmentRevision,
  backend: operation.session.backend,
  backendEpoch: 1,
  basePreviewUrl: 'blob:base',
  devicePixelRatio: 2,
  devicePixelRatioEpoch: 1,
  generation: operation.generation,
  geometryEpoch: 1,
  geometryIdentity: operation.session.geometryRevision,
  graphEpoch: 1,
  graphIdentity: operation.session.graphRevision,
  imageSessionId: operation.session.imageSessionId,
  maskRevision: operation.session.maskRevision,
  patchRevision: operation.session.patchRevision,
  proofRevision: operation.session.proofRevision,
  roiEpoch: 1,
  roiH: null,
  roiW: null,
  roiX: null,
  roiY: null,
  selectionEpoch: 1,
  sourceImagePath: operation.session.sourceImagePath,
  targetResolution: operation.session.targetWidth,
  viewportEpoch: 1,
  viewportIdentity: operation.session.viewportRevision,
});

const context = (identity: PreviewOperationIdentity, overrides: Partial<PreviewPresentationContext> = {}) => ({
  createdAt: 10,
  identity,
  inputToDispatchMs: 2,
  interactiveIdentity: interactiveIdentity(identity),
  quality,
  renderMs: 8,
  scopeRecovery: false,
  targetResolution: identity.session.targetWidth,
  ...overrides,
});

const scopeStatus: PreviewScopeStatus = {
  displayTransformLabel: 'Display transform',
  exportProfileLabel: null,
  exportRenderingIntentLabel: null,
  histogramReady: true,
  path: '/fixtures/a.raw',
  renderBasis: 'editor_preview',
  softProofTransformApplied: false,
  sourceLabel: 'Editor preview',
  updatedAt: '2026-07-15T12:00:00.000Z',
  waveformReady: true,
  workingTransformLabel: 'ACEScg',
  warningCodes: [],
};

const transform: ExportSoftProofTransformState = {
  blackPointCompensation: 'disabled',
  colorManagedTransform: 'ACEScg to Display P3',
  effectiveColorProfile: 'Display P3',
  effectiveRenderingIntent: 'relative_colorimetric',
  policyStatus: 'ready',
  policyVersion: '1',
  sourcePrecisionPath: 'f32',
  transformApplied: true,
  transformPolicyFingerprint: 'sha256:proof',
};

const start = (coordinator: PreviewCoordinator, identity: PreviewSessionIdentity): PreviewOperationIdentity => {
  const queued = coordinator.dispatch({ identity, kind: 'settled', type: 'render-inputs-changed' });
  const operation = queued.state.settled.identity;
  if (operation === undefined) throw new Error('Expected a settled preview identity.');
  coordinator.dispatch({ identity: operation, type: 'operation-started' });
  return operation;
};

const complete = (coordinator: PreviewCoordinator, identity: PreviewOperationIdentity, url?: string): void => {
  coordinator.dispatch({
    ...(url === undefined ? {} : { artifact: { identity, url } }),
    identity,
    type: 'operation-completed',
  });
};

const harness = () => {
  const coordinator = new PreviewCoordinator();
  const updates: PreviewPresentationUpdate[] = [];
  const timings: PreviewTimingSample[] = [];
  const times = [100, 104, 108];
  const adapter = new PreviewPresentationAdapter({
    acceptWgpuPresentation: (commit) =>
      updates.push({
        interactivePatch: null,
        previewQualityStatus: commit.previewQualityStatus,
        ...(commit.renderedPreviewResolution === undefined
          ? {}
          : { renderedPreviewResolution: commit.renderedPreviewResolution }),
      }),
    getCoordinatorState: () => coordinator.snapshot(),
    getPresentationState: () => ({ imageSessionId: 'editor-session-a', previewScopeStatus: scopeStatus }),
    now: () => times.shift() ?? 108,
    publish: (update) => updates.push(update),
    recordTiming: (sample) => timings.push(sample),
  });
  return { adapter, coordinator, timings, updates };
};

describe('preview presentation adapter', () => {
  test('publishes a full soft-proof frame and timing from the exact presented operation', () => {
    const { adapter, coordinator, timings, updates } = harness();
    const identity = start(coordinator, session());
    complete(coordinator, identity, 'blob:full');

    expect(
      adapter.present(
        { decodeMs: 3, value: { kind: 'full', transform, url: 'blob:full' } },
        context(identity, { scopeRecovery: true }),
      ),
    ).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.navigatorPreviewArtifact).toEqual({
      graphIdentity: 'graph-a',
      id: `graph-a:${String(identity.generation)}:${String(identity.operationId)}`,
      imageSessionId: 'editor-session-a',
      url: 'blob:full',
    });
    expect(updates[0]?.previewScopeStatus).toMatchObject({
      exportProfileLabel: 'Display P3',
      renderBasis: 'export_preview',
      softProofTransformApplied: true,
    });
    expect(updates[0]?.previewScopeRecoveryError).toBeNull();
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ commitMs: 4, decodeMs: 3, displayedAgeMs: 98 });
  });

  test('maps positioned patch geometry without reconstructing source identity in React', () => {
    const { adapter, coordinator, updates } = harness();
    const identity = start(coordinator, session());
    complete(coordinator, identity);
    const patch: Extract<PreviewPresentationValue, { kind: 'patch' }> = {
      kind: 'patch',
      patch: {
        fullHeight: 1200,
        fullWidth: 1600,
        imageBuffer: new ArrayBuffer(0),
        normH: 0.5,
        normW: 0.5,
        normX: 0.25,
        normY: 0.25,
        ok: true,
        pixelHeight: 600,
        pixelWidth: 800,
      },
      url: 'blob:patch',
    };

    expect(adapter.present({ value: patch }, context(identity))).toBe(true);
    expect(updates[0]?.interactivePatch).toMatchObject({
      geometryIdentity: 1,
      sourceImagePath: '/fixtures/a.raw',
      url: 'blob:patch',
    });
  });

  test('reordered A to B to successor-A callbacks publish only the exact successor', () => {
    const { adapter, coordinator, updates } = harness();
    const firstA = start(coordinator, session());
    const b = start(
      coordinator,
      session({ graphRevision: 'graph-b', imageSessionId: 2, sourceImagePath: '/fixtures/b.raw', sourceRevision: 2 }),
    );
    const successorA = start(
      coordinator,
      session({ graphRevision: 'graph-successor-a', imageSessionId: 3, sourceRevision: 3 }),
    );
    complete(coordinator, successorA);
    complete(coordinator, b);
    complete(coordinator, firstA);

    expect(adapter.present({ value: { kind: 'wgpu' } }, context(firstA))).toBe(false);
    expect(adapter.present({ value: { kind: 'wgpu' } }, context(b))).toBe(false);
    expect(adapter.present({ value: { kind: 'wgpu' } }, context(successorA))).toBe(true);
    expect(updates).toHaveLength(0);
  });

  test('keeps the current CPU layer visible until zoom WGPU work has a visible frame receipt', () => {
    const { adapter, coordinator, updates } = harness();
    const fit = start(coordinator, session({ viewportRevision: 1 }));
    complete(coordinator, fit);
    expect(adapter.present({ value: { kind: 'wgpu' } }, context(fit))).toBe(true);

    const zoom = start(coordinator, session({ graphRevision: 'graph-zoom', viewportRevision: 2 }));
    complete(coordinator, zoom);
    expect(adapter.present({ value: { kind: 'wgpu' } }, context(zoom))).toBe(true);
    expect(updates).toHaveLength(0);
  });

  test('empty and limited output publish bounded degraded status only while current', () => {
    const { adapter, coordinator, updates } = harness();
    const empty = start(coordinator, session());
    complete(coordinator, empty);
    expect(adapter.present({ value: { kind: 'empty' } }, context(empty))).toBe(true);
    const limited = start(coordinator, session({ adjustmentRevision: 2, graphRevision: 'graph-2' }));
    complete(coordinator, limited);
    expect(adapter.present({ value: { kind: 'limited', reason: 'roi_payload_invalid' } }, context(limited))).toBe(true);

    expect(updates.map((update) => update.previewQualityStatus.reason)).toEqual([
      'empty_render_buffer',
      'roi_payload_invalid',
    ]);
    expect(updates.every((update) => update.previewQualityStatus.phase === 'degraded_limited')).toBe(true);
  });
});
