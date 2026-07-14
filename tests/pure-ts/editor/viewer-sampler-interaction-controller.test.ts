import { describe, expect, test } from 'bun:test';
import { resolveViewerSamplerInteraction } from '../../../src/components/panel/editor/viewerSamplerInteractionController';

const context = {
  compareDividerPosition: 0.5,
  compareMode: 'split-wipe' as const,
  compareOrientation: 'vertical' as const,
  displayedImageRect: { height: 800, width: 1200, x: 0, y: 0 },
  editedRenderSize: { height: 800, offsetX: 0, offsetY: 0, width: 1200 },
  geometryEpoch: 7,
  graphRevision: 'graph:9',
  imageIdentity: '/private/image.arw',
  originalRenderSize: { height: 800, offsetX: 0, offsetY: 0, width: 1200 },
  proofEnabled: false,
  sourceImageSize: { height: 2400, width: 3600 },
};

const surface = { height: 800, layoutHeight: 800, layoutWidth: 1200, width: 1200, x: 0, y: 0 };

describe('viewer sampler interaction controller', () => {
  test('maps a pointer to a canonical edited request on the right split side', () => {
    const result = resolveViewerSamplerInteraction(context, { altKey: false, clientX: 900, clientY: 400 }, surface);

    expect(result?.target).toBe('edited');
    expect(result?.request).toMatchObject({
      geometryEpoch: 7,
      graphRevision: 'graph:9',
      imageIdentity: '/private/image.arw',
      normalizedImagePoint: { x: 0.75, y: 0.5 },
      sampleRadiusImagePx: 0,
    });
  });

  test('selects original pixels on the left side and honors Alt radius', () => {
    const result = resolveViewerSamplerInteraction(context, { altKey: true, clientX: 300, clientY: 200 }, surface);

    expect(result?.target).toBe('original');
    expect(result?.request.sampleRadiusImagePx).toBe(4);
    expect(result?.request.normalizedImagePoint).toEqual({ x: 0.25, y: 0.25 });
  });

  test('returns no request when the pointer is outside the displayed image', () => {
    expect(
      resolveViewerSamplerInteraction(context, { altKey: false, clientX: 1300, clientY: 400 }, surface),
    ).toBeNull();
  });

  test('fails closed when the surface has no measurable layout', () => {
    expect(
      resolveViewerSamplerInteraction(
        context,
        { altKey: false, clientX: 10, clientY: 10 },
        {
          ...surface,
          layoutWidth: 0,
        },
      ),
    ).toBeNull();
  });
});
