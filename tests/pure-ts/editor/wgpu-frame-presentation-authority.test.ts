import { describe, expect, test } from 'bun:test';

import type { PreviewQualityStatus } from '../../../src/utils/adaptivePreviewQuality';
import type { PreviewOperationIdentity } from '../../../src/utils/previewCoordinator';
import {
  WgpuFramePresentationAuthority,
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

describe('WGPU frame presentation authority', () => {
  test('commits only after the accepted operation and native frame receipt join exactly in either order', () => {
    const authority = new WgpuFramePresentationAuthority();
    const identity = operation();
    authority.installImageSession({ imageSessionId: 1, sourceImagePath: '/fixtures/a.raw' });

    expect(authority.recordFrameReady(identity)).toBeNull();
    expect(authority.acceptPreview(commit(identity))).toEqual(commit(identity));

    const successor = operation({ generation: 2, operationId: 2 });
    expect(authority.acceptPreview(commit(successor))).toBeNull();
    expect(authority.recordFrameReady(successor)).toEqual(commit(successor));
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
    expect(authority.recordFrameReady(previous)).toBeNull();
    expect(authority.recordFrameReady(reopened)).toEqual(commit(reopened));
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
    expect(authority.recordFrameReady(fit)).toBeNull();
    expect(authority.recordFrameReady(zoom)).toEqual(commit(zoom));
  });
});
