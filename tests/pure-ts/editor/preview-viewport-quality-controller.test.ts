import { describe, expect, test } from 'bun:test';
import {
  PreviewViewportQualityController,
  type PreviewViewportQualityInput,
} from '../../../src/utils/previewViewportQualityController';

const input = (values: Partial<PreviewViewportQualityInput> = {}): PreviewViewportQualityInput => ({
  baseRenderSize: {
    containerHeight: 800,
    containerWidth: 1200,
    height: 800,
    offsetX: 0,
    offsetY: 0,
    width: 1200,
  },
  crop: null,
  devicePixelRatio: 1,
  enableZoomHifi: true,
  highResZoomMultiplier: 1,
  orientationSteps: 0,
  originalSize: { height: 4000, width: 6000 },
  previewResolution: 1920,
  transform: { positionX: 0, positionY: 0, scale: 1 },
  zoomMode: { kind: 'fit' },
  ...values,
});

describe('preview viewport quality controller', () => {
  test('owns exact ROI, semantic zoom, DPR, and target-resolution identity', () => {
    const controller = new PreviewViewportQualityController();
    const fit = controller.snapshot(input());
    const hidpi = controller.snapshot(input({ devicePixelRatio: 2 }));
    const inspection = controller.snapshot(
      input({
        devicePixelRatio: 2,
        transform: { positionX: -300, positionY: -200, scale: 2 },
        zoomMode: { devicePixelsPerImagePixel: 1, kind: 'ratio' },
      }),
    );

    expect(fit).toMatchObject({
      requestedTargetResolution: 2048,
      roi: null,
      roiFingerprint: '[0,0,1,1]',
      semanticZoom: 'fit',
      sourceHeight: 4000,
      sourceWidth: 6000,
    });
    expect(hidpi.requestedTargetResolution).toBe(3072);
    expect(inspection).toMatchObject({
      requestedTargetResolution: 6000,
      roi: [0.125, 0.125, 0.5, 0.5],
      roiFingerprint: '[0.125,0.125,0.5,0.5]',
      semanticZoom: 'inspection',
    });
  });

  test('derives zoom requests from cropped source identity and preserves configured fallback', () => {
    const controller = new PreviewViewportQualityController();
    const cropped = controller.snapshot(
      input({
        crop: { height: 1800, unit: 'px', width: 2400, x: 0, y: 0 },
        zoomMode: { devicePixelsPerImagePixel: 2, kind: 'ratio' },
      }),
    );
    const disabled = controller.snapshot(
      input({
        baseRenderSize: {
          containerHeight: 0,
          containerWidth: 0,
          height: 0,
          offsetX: 0,
          offsetY: 0,
          width: 0,
        },
        enableZoomHifi: false,
        previewResolution: 1536,
      }),
    );

    expect(cropped).toMatchObject({ requestedTargetResolution: 3072, sourceHeight: 1800, sourceWidth: 2400 });
    expect(disabled.requestedTargetResolution).toBe(1536);
  });

  test('uses fake time and presented render receipts to adapt interaction quality, then resets by session', () => {
    let now = 0;
    const controller = new PreviewViewportQualityController(() => now);
    const viewport = controller.snapshot(input({ zoomMode: { kind: 'fill' } }));
    const first = controller.decide({ backend: 'cpu', interacting: true, operationClass: 'mask', viewport });
    controller.record({
      commitMs: 2,
      decodeMs: 4,
      displayedAgeMs: 220,
      inputToDispatchMs: 5,
      renderMs: 200,
      tier: first.tier,
    });
    now = 10;
    const pressured = controller.decide({ backend: 'cpu', interacting: true, operationClass: 'mask', viewport });
    controller.reset();
    now = 20;
    const reset = controller.decide({ backend: 'cpu', interacting: true, operationClass: 'mask', viewport });

    expect(first.tier).toBe('interaction_balanced');
    expect(pressured.tier).toBe('interaction_low');
    expect(pressured.effectiveTargetResolution).toBeLessThan(first.effectiveTargetResolution);
    expect(reset.tier).toBe('interaction_balanced');
  });
});
