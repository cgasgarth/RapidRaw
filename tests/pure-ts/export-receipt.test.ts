import { test, expect } from 'bun:test';

import { parseExportReceiptPayload } from '../../src/schemas/tauriEventSchemas';

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
    total: 1,
  });

  expect(receipt.outputs[0]?.bitDepth).toBeUndefined();
  expect(receipt.outputs[0]?.colorProfile).toBeUndefined();
  expect(receipt.outputs[0]?.renderingIntent).toBeUndefined();
});
