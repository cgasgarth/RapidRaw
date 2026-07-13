import { describe, expect, test } from 'bun:test';

import { imageOpenUpdateSchema, type ProgressiveImageFrameReceipt } from '../../../src/schemas/imageLoaderSchemas';
import { resolveEditorPreviewSource } from '../../../src/utils/editorImagePreviewSource';
import {
  type AuthoritativeFrameConsumer,
  canPublishProvisionalFrame,
  canUseFrameForAuthoritativeConsumer,
  isAuthoritativeFrame,
} from '../../../src/utils/progressiveImageFrame';

const provisional = (frameGeneration: number, selectionGeneration = 4): ProgressiveImageFrameReceipt => ({
  colorAssumption: 'encoded_srgb_vendor_preview',
  frameGeneration,
  height: 1365,
  imageSession: selectionGeneration,
  orientationApplied: true,
  provisionalReason: 'camera-rendered latency bridge; not authoritative pixels',
  quality: 'embeddedProvisional',
  selectionGeneration,
  sourceKind: 'arw',
  sourceRevision: 'source-revision-v1:fixture',
  width: 2048,
});

describe('progressive image frame sequencing', () => {
  test('strictly parses the provisional transport contract', () => {
    expect(
      imageOpenUpdateSchema.parse({
        dataUrl: 'data:image/jpeg;base64,AAAA',
        imageId: 'image-a',
        path: '/fixture/a.arw',
        phase: 'frameReady',
        receipt: provisional(1),
        sessionId: { imageSession: 4, selectionGeneration: 4 },
      }).phase,
    ).toBe('frameReady');
    expect(
      imageOpenUpdateSchema.parse({
        imageId: 'image-a',
        path: '/fixture/a.arw',
        phase: 'fallbackFrameReady',
        receipt: {
          ...provisional(1),
          colorAssumption: 'artifact_declared_or_srgb_fallback',
          height: 0,
          quality: 'fastDeveloped',
          sourceKind: 'current_thumbnail_or_smart_preview',
          width: 0,
        },
        sessionId: { imageSession: 4, selectionGeneration: 4 },
      }).phase,
    ).toBe('fallbackFrameReady');
  });

  test('rejects stale sessions, duplicate generations, and provisional-after-settled', () => {
    expect(canPublishProvisionalFrame({ current: null, expectedGeneration: 4, incoming: provisional(1) })).toBeTrue();
    expect(
      canPublishProvisionalFrame({ current: provisional(2), expectedGeneration: 4, incoming: provisional(2) }),
    ).toBeFalse();
    expect(
      canPublishProvisionalFrame({ current: null, expectedGeneration: 4, incoming: provisional(1, 3) }),
    ).toBeFalse();
    expect(
      canPublishProvisionalFrame({
        current: { ...provisional(2), provisionalReason: null, quality: 'settledDeveloped' },
        expectedGeneration: 4,
        incoming: provisional(3),
      }),
    ).toBeFalse();
  });

  test('only settled-developed receipts are authoritative', () => {
    expect(isAuthoritativeFrame(provisional(1))).toBeFalse();
    expect(
      isAuthoritativeFrame({ ...provisional(2), provisionalReason: null, quality: 'settledDeveloped' }),
    ).toBeTrue();
  });

  test('display may use provisional pixels while every authoritative consumer rejects them', () => {
    const receipt = provisional(1);
    expect(
      resolveEditorPreviewSource({
        finalPreviewUrl: null,
        isReady: false,
        provisionalPreviewUrl: 'data:image/jpeg;base64,AAAA',
        thumbnailUrl: 'thumbnail://fallback',
      }),
    ).toBe('data:image/jpeg;base64,AAAA');
    const consumers: AuthoritativeFrameConsumer[] = ['analytics', 'compare', 'export', 'mask', 'proof', 'sampler'];
    for (const consumer of consumers) {
      expect(canUseFrameForAuthoritativeConsumer(receipt, consumer)).toBeFalse();
    }
  });
});
