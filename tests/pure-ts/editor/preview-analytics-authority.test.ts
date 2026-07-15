import { describe, expect, test } from 'bun:test';

import { PreviewAnalyticsAuthority } from '../../../src/utils/previewAnalyticsAuthority';
import type { PreviewArtifact, PreviewOperationIdentity } from '../../../src/utils/previewCoordinator';

const identity = ({
  graphRevision = 'graph-a',
  imageSessionId = 1,
  operationId = 1,
  path = '/fixtures/a.raw',
}: {
  graphRevision?: string;
  imageSessionId?: number;
  operationId?: number;
  path?: string;
} = {}): PreviewOperationIdentity => ({
  generation: operationId,
  kind: 'settled',
  operationId,
  session: {
    adjustmentRevision: 1,
    backend: 'cpu',
    displayGeneration: 1,
    geometryRevision: 0,
    graphRevision,
    imageSessionId,
    maskRevision: 0,
    patchRevision: 0,
    proofRevision: 0,
    roiFingerprint: '[0,0,1,1]',
    sourceImagePath: path,
    sourceRevision: imageSessionId,
    targetHeight: 1200,
    targetWidth: 1200,
    viewportRevision: 1,
  },
});

const artifact = (operation: PreviewOperationIdentity): PreviewArtifact => ({
  identity: operation,
  url: `blob:preview-${String(operation.operationId)}`,
});

const result = (operation: PreviewOperationIdentity, marker: string) => ({
  marker,
  path: operation.session.sourceImagePath,
  previewOperationIdentity: operation,
});

describe('preview analytics authority', () => {
  test('holds an early native result until its exact operation is presented', () => {
    const authority = new PreviewAnalyticsAuthority<ReturnType<typeof result>>();
    const operation = identity();

    expect(authority.receive(result(operation, 'early'))).toBeNull();
    expect(authority.pendingCount()).toBe(1);
    expect(authority.setPresented(artifact(operation))?.marker).toBe('early');
    expect(authority.pendingCount()).toBe(0);
  });

  test('A to B to successor A rejects reordered old A even though source and graph repeat', () => {
    const authority = new PreviewAnalyticsAuthority<ReturnType<typeof result>>();
    const firstA = identity({ operationId: 1 });
    const b = identity({ imageSessionId: 2, operationId: 2, path: '/fixtures/b.raw' });
    const successorA = identity({ imageSessionId: 3, operationId: 3 });

    authority.setPresented(artifact(firstA));
    expect(authority.receive(result(firstA, 'first-a'))?.marker).toBe('first-a');
    authority.setPresented(artifact(b));
    expect(authority.receive(result(firstA, 'late-first-a'))).toBeNull();
    authority.setPresented(artifact(successorA));
    expect(authority.receive(result(firstA, 'later-first-a'))).toBeNull();
    expect(authority.receive(result(successorA, 'successor-a'))?.marker).toBe('successor-a');
  });

  test('a newer failed preview does not displace analytics for the still-presented artifact', () => {
    const authority = new PreviewAnalyticsAuthority<ReturnType<typeof result>>();
    const presented = identity({ operationId: 4 });
    const failed = identity({ operationId: 5 });

    authority.setPresented(artifact(presented));
    expect(authority.receive(result(failed, 'failed-preview'))).toBeNull();
    expect(authority.receive(result(presented, 'late-current'))?.marker).toBe('late-current');
    expect(authority.pendingCount()).toBe(1);
  });

  test('rejects path, image-session, graph, and operation mismatches independently', () => {
    const authority = new PreviewAnalyticsAuthority<ReturnType<typeof result>>();
    const current = identity({ operationId: 10 });
    authority.setPresented(artifact(current));

    const mismatches = [
      identity({ operationId: 10, path: '/fixtures/b.raw' }),
      identity({ imageSessionId: 2, operationId: 10 }),
      identity({ graphRevision: 'graph-b', operationId: 10 }),
      identity({ operationId: 11 }),
    ];
    for (const mismatch of mismatches) expect(authority.receive(result(mismatch, 'stale'))).toBeNull();
    expect(authority.receive(result(current, 'current'))?.marker).toBe('current');
  });
});
