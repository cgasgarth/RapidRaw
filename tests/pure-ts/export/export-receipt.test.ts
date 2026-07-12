import { expect, test } from 'bun:test';

import { parseExportReceiptPayload } from '../../../src/schemas/tauriEventSchemas';

test('export receipt accepts TIFF color profile and bit depth metadata', () => {
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-06-23T04:00:00.000Z',
    outputs: [
      {
        bitDepth: 16,
        byteSize: 1024,
        colorProfile: 'sRGB',
        format: 'tiff',
        outputPath: '/tmp/export.tiff',
        policyStatus: 'applied',
        renderingIntent: 'Relative colorimetric',
        sourcePath: '/tmp/source.arw',
        requestedRenderingIntent: 'Relative colorimetric',
        resolvedDisabledReason: null,
        effectiveRenderingIntent: 'Relative colorimetric',
      },
    ],
    terminalStatus: 'completed',
    total: 1,
  });

  expect(receipt.outputs[0]?.bitDepth).toBe(16);
  expect(receipt.outputs[0]?.colorProfile).toBe('sRGB');
  expect(receipt.outputs[0]?.policyStatus).toBe('applied');
  expect(receipt.outputs[0]?.renderingIntent).toBe('Relative colorimetric');
  expect(receipt.outputs[0]?.effectiveRenderingIntent).toBe('Relative colorimetric');
});

test('export receipt remains compatible with outputs without image metadata', () => {
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-06-23T04:00:00.000Z',
    outputs: [
      {
        byteSize: 256,
        format: 'cube',
        outputPath: '/tmp/look.cube',
        sourcePath: '/tmp/source.arw',
      },
    ],
    terminalStatus: 'completed',
    total: 1,
  });

  expect(receipt.outputs[0]?.bitDepth).toBeUndefined();
  expect(receipt.outputs[0]?.colorProfile).toBeUndefined();
  expect(receipt.outputs[0]?.renderingIntent).toBeUndefined();
});

test('export receipt accepts exact final-byte digest evidence', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-07-12T01:27:38.025Z',
    outputs: [
      {
        byteSize: 3_337_245,
        format: 'jpg',
        outputDigest: {
          algorithm: 'sha256',
          byteLen: 3_337_245,
          provenance: 'finalByteAtomicWriter',
          value: digest,
        },
        outputPath: '/tmp/alaska.jpg',
        rawProvenanceError: null,
        rawProvenanceSidecarPath: '/tmp/alaska.jpg.rawengine-provenance.json',
        sourcePath: '/tmp/alaska.arw',
      },
    ],
    terminalStatus: 'completed',
    total: 1,
  });

  expect(receipt.outputs[0]?.outputDigest?.value).toBe(digest);
  expect(receipt.outputs[0]?.outputDigest?.byteLen).toBe(3_337_245);
  expect(receipt.outputs[0]?.rawProvenanceError).toBeNull();
});

test('export receipt preserves truthful provenance-sidecar failure', () => {
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-07-12T01:27:38.025Z',
    outputs: [
      {
        byteSize: 3_337_245,
        format: 'jpg',
        outputDigest: {
          algorithm: 'sha256',
          byteLen: 3_337_245,
          provenance: 'finalByteAtomicWriter',
          value: `sha256:${'b'.repeat(64)}`,
        },
        outputPath: '/tmp/alaska.jpg',
        rawProvenanceError: 'source_changed_before_provenance_commit',
        rawProvenanceSidecarPath: null,
        sourcePath: '/tmp/alaska.arw',
      },
    ],
    terminalStatus: 'completed',
    total: 1,
  });

  expect(receipt.outputs[0]?.rawProvenanceSidecarPath).toBeNull();
  expect(receipt.outputs[0]?.rawProvenanceError).toBe('source_changed_before_provenance_commit');
});

test('source-embedded export receipt preserves passthrough and ICC identity evidence', () => {
  const sourceIccProfileHash = 'sha256:d2ff5597fd937a24f90548f5e85803545334fcfd480601d19c3bc225d7355733';
  const transformPolicyFingerprint = 'sha256:9b6445d090788179c63331baf27476d9f4542c37fb84b757509fa8a1ed5db01e';
  const receipt = parseExportReceiptPayload({
    completedAt: '2026-07-09T18:00:00.000Z',
    outputs: [
      {
        bitDepth: 8,
        blackPointCompensation: 'Unavailable for this export path',
        byteSize: 12_345,
        cmm: 'moxcms',
        colorManagedTransform: 'Source embedded profile passthrough; ICC embedded',
        colorProfile: 'Source embedded',
        effectiveColorProfile: 'Source embedded',
        effectiveRenderingIntent: 'Relative colorimetric',
        format: 'jpg',
        iccEmbedded: true,
        outputPath: '/tmp/source-embedded-output.jpg',
        policyStatus: 'applied',
        policyVersion: 'rawengine-export-color-policy-v2',
        renderingIntent: 'Relative colorimetric',
        requestedColorProfile: 'Source embedded',
        requestedRenderingIntent: 'Relative colorimetric',
        resolvedDisabledReason: null,
        sourceIccProfileHash,
        sourcePath: '/tmp/source-embedded-display-p3.jpg',
        transformApplied: false,
        transformPolicyFingerprint,
      },
    ],
    terminalStatus: 'completed',
    total: 1,
  });

  expect(receipt.outputs[0]?.colorManagedTransform).toContain('passthrough');
  expect(receipt.outputs[0]?.iccEmbedded).toBe(true);
  expect(receipt.outputs[0]?.sourceIccProfileHash).toBe(sourceIccProfileHash);
  expect(receipt.outputs[0]?.transformApplied).toBe(false);
  expect(receipt.outputs[0]?.transformPolicyFingerprint).toBe(transformPolicyFingerprint);
});
