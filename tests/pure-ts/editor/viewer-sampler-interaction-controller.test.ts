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
    expect(result?.viewPoint).toEqual({ x: 900, y: 400 });
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

  test('keeps overlay and command coordinates identical across fit, fill, 1:1, crop/orientation, and DPR scale', () => {
    const scenarios = [
      {
        displayedImageRect: { height: 400, width: 800, x: 100, y: 50 },
        label: 'fit',
        normalized: { x: 0.25, y: 0.75 },
        surface: { height: 500, layoutHeight: 500, layoutWidth: 1000, width: 1000, x: 10, y: 20 },
      },
      {
        displayedImageRect: { height: 700, width: 1200, x: -100, y: -100 },
        label: 'fill',
        normalized: { x: 0.5, y: 0.5 },
        surface: { height: 500, layoutHeight: 500, layoutWidth: 1000, width: 1000, x: 0, y: 0 },
      },
      {
        displayedImageRect: { height: 600, width: 400, x: 200, y: 100 },
        label: '1:1 crop/orientation at DPR transform',
        normalized: { x: 0.75, y: 0.25 },
        surface: { height: 1600, layoutHeight: 800, layoutWidth: 1000, width: 2000, x: 30, y: 40 },
      },
    ] as const;

    for (const scenario of scenarios) {
      const scaleX = scenario.surface.width / scenario.surface.layoutWidth;
      const scaleY = scenario.surface.height / scenario.surface.layoutHeight;
      const clientX =
        scenario.surface.x +
        (scenario.displayedImageRect.x + scenario.normalized.x * scenario.displayedImageRect.width) * scaleX;
      const clientY =
        scenario.surface.y +
        (scenario.displayedImageRect.y + scenario.normalized.y * scenario.displayedImageRect.height) * scaleY;
      const resolved = resolveViewerSamplerInteraction(
        { ...context, compareMode: 'off', displayedImageRect: scenario.displayedImageRect },
        { altKey: false, clientX, clientY },
        scenario.surface,
      );
      expect(resolved?.request.normalizedImagePoint, scenario.label).toEqual(scenario.normalized);
      expect(resolved?.viewPoint, scenario.label).toEqual({
        x: scenario.displayedImageRect.x + scenario.normalized.x * scenario.displayedImageRect.width,
        y: scenario.displayedImageRect.y + scenario.normalized.y * scenario.displayedImageRect.height,
      });
    }
  });
});
