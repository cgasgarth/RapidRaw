import { describe, expect, test } from 'bun:test';

import { ExportColorProfile, ExportRenderingIntent } from '../../../src/components/ui/ExportImportProperties';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildSoftProofProfileCompareInvokeRequest,
  buildSoftProofProfileCompareRequests,
  buildSoftProofProfileCompareUnavailableState,
} from '../../../src/utils/export/exportSoftProofProfileCompare';

describe('export soft-proof profile compare', () => {
  test('wraps the preview payload under the required request key', () => {
    const [srgbRequest] = buildSoftProofProfileCompareRequests({
      blackPointCompensation: false,
      jsAdjustments: structuredClone(INITIAL_ADJUSTMENTS),
      renderingIntent: ExportRenderingIntent.Perceptual,
      targetResolution: 1024,
    });

    if (!srgbRequest) {
      throw new Error('Expected the compare helper to produce an sRGB request.');
    }

    expect(buildSoftProofProfileCompareInvokeRequest(srgbRequest.request)).toEqual({
      request: srgbRequest.request,
    });
    expect(Object.keys(buildSoftProofProfileCompareInvokeRequest(srgbRequest.request))).toEqual(['request']);
  });

  test('keeps unavailable compare state tied to the requested side settings', () => {
    expect(
      buildSoftProofProfileCompareUnavailableState({
        error: 'soft-proof preview unavailable',
        requestedColorProfile: ExportColorProfile.DisplayP3,
        requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
        side: 'displayP3',
      }),
    ).toEqual({
      error: 'soft-proof preview unavailable',
      requestedColorProfile: ExportColorProfile.DisplayP3,
      requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
      side: 'displayP3',
      status: 'unavailable',
    });
  });
});
