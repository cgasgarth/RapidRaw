import { describe, expect, test } from 'bun:test';

import { createViewerPickerCommandServices } from '../../../src/components/panel/editor/viewerPickerCommandServices';

describe('viewer picker command services', () => {
  test('routes typed tone and point requests through injected native adapters', async () => {
    const services = createViewerPickerCommandServices({
      samplePointColor: async (request) => ({
        chroma: 0.2,
        confidence: 0.9,
        graphFingerprint: 'graph-fp',
        graphRevision: String(request.graphRevision),
        hueDegrees: 120,
        lightness: 0.1,
        sampleRadiusPx: 8,
        sourceFingerprint: 'source-fp',
        sourceIdentity: String(request.sourceIdentity),
      }),
      sampleToneEqualizer: async (request) => ({
        contributingWeights: [0, 0, 0, 0, 1, 0, 0, 0, 0],
        exposureEv: 0.5,
        graphFingerprint: 'graph-fp',
        graphRevision: String(request.graphRevision),
        primaryBand: 4,
        sourceFingerprint: 'source-fp',
        sourceIdentity: String(request.sourceIdentity),
      }),
    });
    await expect(
      services.samplePointColor({ graphRevision: 'graph:1', sourceIdentity: 'image-a' }),
    ).resolves.toMatchObject({
      hueDegrees: 120,
      sourceIdentity: 'image-a',
    });
    await expect(
      services.sampleToneEqualizer({ graphRevision: 'graph:1', sourceIdentity: 'image-a' }),
    ).resolves.toMatchObject({
      primaryBand: 4,
      sourceIdentity: 'image-a',
    });
  });
});
