import { describe, expect, test } from 'bun:test';

import { ExportColorProfile, ExportRenderingIntent } from '../../src/components/ui/ExportImportProperties';
import { INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  buildSoftProofProfileCompareProof,
  buildSoftProofProfileCompareRequests,
  describeSoftProofProfileRole,
  getSoftProofProfileCompareStatus,
} from '../../src/utils/exportSoftProofProfileCompare';

const metadata = {
  blackPointCompensation: 'disabled',
  colorManagedTransform: 'moxcms-export-soft-proof',
  effectiveColorProfile: 'sRGB',
  effectiveRenderingIntent: 'Perceptual',
  policyStatus: 'managed',
  policyVersion: 'export-color-policy-v1',
  sourcePrecisionPath: 'rgba16-linear-working',
  transformApplied: false,
  transformPolicyFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

describe('export soft-proof profile compare', () => {
  test('builds paired sRGB and Display P3 requests for the same adjustment payload', () => {
    const requests = buildSoftProofProfileCompareRequests({
      blackPointCompensation: true,
      jsAdjustments: INITIAL_ADJUSTMENTS,
      renderingIntent: ExportRenderingIntent.Perceptual,
      targetResolution: 1024,
    });

    expect(requests.map((entry) => entry.side)).toEqual(['srgb', 'displayP3']);
    expect(requests[0]?.request.colorProfile).toBe(ExportColorProfile.Srgb);
    expect(requests[1]?.request.colorProfile).toBe(ExportColorProfile.DisplayP3);
    expect(requests[0]?.request.jsAdjustments).toBe(requests[1]?.request.jsAdjustments);
    expect(requests.every((entry) => entry.request.renderingIntent === ExportRenderingIntent.Perceptual)).toBe(true);
  });

  test('labels perceptual sRGB separately from identity relative proofing', () => {
    expect(
      describeSoftProofProfileRole({
        requestedColorProfile: ExportColorProfile.Srgb,
        requestedRenderingIntent: ExportRenderingIntent.Perceptual,
        transformApplied: false,
      }),
    ).toBe('srgb-perceptual-gamut-map');

    expect(
      describeSoftProofProfileRole({
        requestedColorProfile: ExportColorProfile.Srgb,
        requestedRenderingIntent: ExportRenderingIntent.RelativeColorimetric,
        transformApplied: false,
      }),
    ).toBe('srgb-relative-identity');
  });

  test('keeps distinct proof metadata and nonzero preview hashes', () => {
    const [srgbRequest, displayP3Request] = buildSoftProofProfileCompareRequests({
      blackPointCompensation: false,
      jsAdjustments: INITIAL_ADJUSTMENTS,
      renderingIntent: ExportRenderingIntent.RelativeColorimetric,
      targetResolution: 1024,
    });
    if (!srgbRequest || !displayP3Request) throw new Error('Expected paired soft-proof requests.');

    const srgbProof = buildSoftProofProfileCompareProof({
      buffer: new Uint8Array([1, 2, 3, 4]).buffer,
      label: 'sRGB',
      metadata,
      previewUrl: 'blob:srgb',
      request: srgbRequest.request,
      side: 'srgb',
    });
    const displayP3Proof = buildSoftProofProfileCompareProof({
      buffer: new Uint8Array([1, 2, 3, 5]).buffer,
      label: 'Display P3',
      metadata: {
        ...metadata,
        effectiveColorProfile: 'Display P3',
        effectiveRenderingIntent: 'Relative Colorimetric',
        transformApplied: true,
        transformPolicyFingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      previewUrl: 'blob:p3',
      request: displayP3Request.request,
      side: 'displayP3',
    });

    expect(srgbProof.requestedColorProfile).toBe(ExportColorProfile.Srgb);
    expect(displayP3Proof.requestedColorProfile).toBe(ExportColorProfile.DisplayP3);
    expect(srgbProof.previewHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(displayP3Proof.previewHash).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(srgbProof.previewHash).not.toBe(displayP3Proof.previewHash);
    expect(srgbProof.transformPolicyFingerprint).not.toBe(displayP3Proof.transformPolicyFingerprint);
    expect(
      getSoftProofProfileCompareStatus({
        displayP3: { proof: displayP3Proof, side: 'displayP3', status: 'ready' },
        srgb: { proof: srgbProof, side: 'srgb', status: 'ready' },
      }),
    ).toBe('ready');
  });
});
