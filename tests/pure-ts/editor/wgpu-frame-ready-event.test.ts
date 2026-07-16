import { describe, expect, test } from 'bun:test';

import { parseWgpuFrameReadyPayload } from '../../../src/schemas/tauriEventSchemas';

const payload = {
  generation: 8,
  height: 1200,
  imageSession: 5,
  path: '/fixtures/current.raw',
  presentationHealth: {
    contentFingerprint: `sha256:${'a'.repeat(64)}`,
    maxChroma: 0.25,
    maxLuminance: 0.75,
    sampleCount: 25,
    visibleSampleCount: 24,
  },
  previewOperationIdentity: {
    generation: 9,
    kind: 'settled' as const,
    operationId: 41,
    session: {
      adjustmentRevision: 1,
      backend: 'wgpu' as const,
      displayGeneration: 1,
      geometryRevision: 1,
      graphRevision: 'graph-current',
      imageSessionId: 17,
      maskRevision: 1,
      patchRevision: 1,
      proofRevision: 1,
      roiFingerprint: '[0,0,1,1]',
      sourceImagePath: '/fixtures/current.raw',
      sourceRevision: 1,
      targetHeight: 1200,
      targetWidth: 1600,
      viewportRevision: 1,
    },
  },
  submitLatencyMicros: 250,
  width: 1600,
};

describe('WGPU frame-ready event contract', () => {
  test('preserves exact frontend presentation authority', () => {
    expect(parseWgpuFrameReadyPayload(payload).previewOperationIdentity).toEqual(payload.previewOperationIdentity);
  });

  test('rejects path-only receipts that could accept stale same-path frames', () => {
    expect(() => parseWgpuFrameReadyPayload({ path: payload.path })).toThrow();
  });

  test('rejects empty native surfaces before they can publish ready', () => {
    expect(() => parseWgpuFrameReadyPayload({ ...payload, width: 0 })).toThrow();
    expect(() => parseWgpuFrameReadyPayload({ ...payload, height: 0 })).toThrow();
  });

  test('requires bounded native content evidence on every frame receipt', () => {
    expect(() => parseWgpuFrameReadyPayload({ ...payload, presentationHealth: undefined })).toThrow();
    expect(() =>
      parseWgpuFrameReadyPayload({
        ...payload,
        presentationHealth: { ...payload.presentationHealth, visibleSampleCount: 26 },
      }),
    ).toThrow();
  });
});
