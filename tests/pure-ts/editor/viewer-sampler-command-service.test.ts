import { describe, expect, test } from 'bun:test';

import { createViewerSamplerCommandService } from '../../../src/components/panel/editor/viewerSamplerCommandService';
import { createViewerSampleRequest } from '../../../src/utils/viewerSampler';

const request = createViewerSampleRequest({
  geometryEpoch: 3,
  graphRevision: 'graph:4',
  imageIdentity: '/fixture/image.arw',
  normalizedImagePoint: { x: 0.25, y: 0.75 },
  requestedSpace: 'displayEncoded',
  sampleRadiusImagePx: 0,
  sourceImageSize: { height: 1200, width: 1600 },
  target: 'edited',
});

describe('viewer sampler command service', () => {
  test('keeps native invocation behind an injectable typed boundary', async () => {
    const seen: string[] = [];
    const service = createViewerSamplerCommandService(async (received) => {
      seen.push(received.requestIdentity);
      return {
        clippedChannels: [],
        imagePointPx: { x: 400, y: 900 },
        luma: 0.42,
        requestIdentity: received.requestIdentity,
        rgb: [0.1, 0.2, 0.3],
        spaceLabel: 'Display encoded',
        status: 'available',
      };
    });
    const result = await service.sample(request);
    expect(result.status).toBe('available');
    expect(seen).toEqual([request.requestIdentity]);
  });

  test('preserves unavailable native responses as typed results', async () => {
    const service = createViewerSamplerCommandService(async (received) => ({
      reason: 'staleFrame' as const,
      requestIdentity: received.requestIdentity,
      spaceLabel: 'Unavailable',
      status: 'unavailable' as const,
    }));
    await expect(service.sample(request)).resolves.toMatchObject({ status: 'unavailable', reason: 'staleFrame' });
  });
});
