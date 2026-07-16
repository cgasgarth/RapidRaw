import { describe, expect, test } from 'bun:test';

import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  PresetPreviewAuthority,
  presetPreviewByteResponseSchema,
  presetPreviewInvokeArgsSchema,
} from '../../../src/utils/presetPreviewContract';

describe('preset preview native contract', () => {
  test('builds the single request envelope and normalizes native byte arrays', () => {
    const authority = new PresetPreviewAuthority();
    authority.installImageSession({ imageSessionId: 7, sourceImagePath: '/fixtures/current.ARW' });

    const args = authority.issue('alaska-proof-look', createDefaultEditDocumentV2());
    expect(args.request.expectedImagePath).toBe('/fixtures/current.ARW');
    expect(args.request.previewIdentity).toEqual({
      imageSessionId: 7,
      presetId: 'alaska-proof-look',
      requestId: 1,
      sourceImagePath: '/fixtures/current.ARW',
    });
    expect(presetPreviewByteResponseSchema.parse([255, 216, 255, 217])).toEqual(new Uint8Array([255, 216, 255, 217]));
  });

  test('rejects the retired flat payload and empty or malformed native bytes', () => {
    expect(() => presetPreviewInvokeArgsSchema.parse({ jsAdjustments: INITIAL_ADJUSTMENTS })).toThrow();
    expect(() => presetPreviewByteResponseSchema.parse([])).toThrow();
    expect(() => presetPreviewByteResponseSchema.parse([256])).toThrow();
  });

  test('rejects a late result after the same source path reopens in a new image session', () => {
    const authority = new PresetPreviewAuthority();
    authority.installImageSession({ imageSessionId: 7, sourceImagePath: '/fixtures/current.ARW' });
    const stale = authority.issue('alaska-proof-look', createDefaultEditDocumentV2()).request.previewIdentity;
    authority.installImageSession({ imageSessionId: 8, sourceImagePath: '/fixtures/current.ARW' });

    expect(authority.accepts(stale)).toBeFalse();
    expect(
      authority.accepts(authority.issue('alaska-proof-look', createDefaultEditDocumentV2()).request.previewIdentity),
    ).toBeTrue();
  });

  test('rejects an older render when the same preset receives a newer request', () => {
    const authority = new PresetPreviewAuthority();
    authority.installImageSession({ imageSessionId: 7, sourceImagePath: '/fixtures/current.ARW' });
    const stale = authority.issue('alaska-proof-look', createDefaultEditDocumentV2()).request.previewIdentity;
    const current = authority.issue('alaska-proof-look', createDefaultEditDocumentV2()).request.previewIdentity;

    expect(authority.accepts(stale)).toBeFalse();
    expect(authority.accepts(current)).toBeTrue();
  });
});
