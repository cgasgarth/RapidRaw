import { describe, expect, test } from 'bun:test';

import type { PreviewQualityStatus } from '../../../src/utils/adaptivePreviewQuality';
import type { PreviewOperationIdentity } from '../../../src/utils/previewCoordinator';
import {
  isVisibleWgpuPresentation,
  WgpuFramePresentationAuthority,
  type WgpuPresentationHealth,
  type WgpuPreviewCommit,
} from '../../../src/utils/wgpuFramePresentationAuthority';

const operation = (overrides: Partial<PreviewOperationIdentity> = {}): PreviewOperationIdentity => ({
  generation: 1,
  kind: 'settled',
  operationId: 1,
  session: {
    adjustmentRevision: 1,
    backend: 'wgpu',
    displayGeneration: 1,
    geometryRevision: 1,
    graphRevision: 'graph-1',
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
  },
  ...overrides,
});

const readyStatus: PreviewQualityStatus = {
  backend: 'wgpu',
  effectiveRoi: null,
  effectiveTargetResolution: 1200,
  estimatedWorkingBytes: 1,
  generation: 1,
  limitedBy: null,
  phase: 'final_ready',
  reason: 'settled viewport',
  requestId: 1,
  requestedTargetResolution: 1200,
  sufficientForSemanticZoom: true,
  tier: 'settled_full',
};

const commit = (identity: PreviewOperationIdentity): WgpuPreviewCommit => ({
  identity,
  previewQualityStatus: { ...readyStatus, generation: identity.generation, requestId: identity.operationId },
  renderedPreviewResolution: identity.session.targetWidth,
});

const healthy: WgpuPresentationHealth = {
  contentFingerprint: `sha256:${'a'.repeat(64)}`,
  maxChroma: 0.4,
  maxLuminance: 0.8,
  sampleCount: 25,
  visibleSampleCount: 24,
};

describe('WGPU frame presentation authority', () => {
  test('commits only after the accepted operation and native frame receipt join exactly in either order', () => {
    const authority = new WgpuFramePresentationAuthority();
    const identity = operation();
    authority.installImageSession({ imageSessionId: 1, sourceImagePath: '/fixtures/a.raw' });

    expect(authority.recordFrameReady(identity, healthy)).toBeNull();
    expect(authority.acceptPreview(commit(identity))).toEqual(commit(identity));

    const successor = operation({ generation: 2, operationId: 2 });
    expect(authority.acceptPreview(commit(successor))).toBeNull();
    expect(authority.recordFrameReady(successor, healthy)).toEqual(commit(successor));
  });

  test('rejects a delayed same-path frame from the previous reopen session', () => {
    const authority = new WgpuFramePresentationAuthority();
    const previous = operation();
    const reopened = operation({
      generation: 2,
      operationId: 2,
      session: { ...previous.session, graphRevision: 'graph-reopened', imageSessionId: 2, sourceRevision: 2 },
    });

    authority.installImageSession({ imageSessionId: 1, sourceImagePath: '/fixtures/a.raw' });
    expect(authority.acceptPreview(commit(previous))).toBeNull();
    authority.installImageSession({ imageSessionId: 2, sourceImagePath: '/fixtures/a.raw' });
    expect(authority.acceptPreview(commit(reopened))).toBeNull();
    expect(authority.recordFrameReady(previous, healthy)).toBeNull();
    expect(authority.recordFrameReady(reopened, healthy)).toEqual(commit(reopened));
  });

  test('keeps the CPU fallback authoritative across zoom until the new viewport frame is exact', () => {
    const authority = new WgpuFramePresentationAuthority();
    const fit = operation();
    const zoom = operation({
      generation: 2,
      operationId: 2,
      session: {
        ...fit.session,
        graphRevision: 'graph-zoom-2x',
        targetHeight: 2400,
        targetWidth: 2400,
        viewportRevision: 2,
      },
    });
    authority.installImageSession({ imageSessionId: 1, sourceImagePath: '/fixtures/a.raw' });

    expect(authority.acceptPreview(commit(zoom))).toBeNull();
    expect(authority.recordFrameReady(fit, healthy)).toBeNull();
    expect(authority.recordFrameReady(zoom, healthy)).toEqual(commit(zoom));
  });

  test('retains the current CPU fallback for black, empty, and invalid native presentation proof', () => {
    const authority = new WgpuFramePresentationAuthority();
    const identity = operation();
    authority.installImageSession({ imageSessionId: 1, sourceImagePath: '/fixtures/a.raw' });
    expect(authority.acceptPreview(commit(identity))).toBeNull();

    const black = { ...healthy, maxChroma: 0, maxLuminance: 0, visibleSampleCount: 0 };
    expect(isVisibleWgpuPresentation(black)).toBeFalse();
    expect(authority.recordFrameReady(identity, black)).toBeNull();
    expect(authority.recordFrameReady(identity, { ...black, sampleCount: 0 })).toBeNull();
    expect(authority.recordFrameReady(identity, { ...healthy, maxLuminance: Number.NaN })).toBeNull();

    expect(authority.recordFrameReady(identity, healthy)).toEqual(commit(identity));
  });
});
