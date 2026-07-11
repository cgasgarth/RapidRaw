import { describe, expect, test } from 'bun:test';

import {
  buildHiddenWgpuTransformPayload,
  buildVisibleWgpuTransformPayload,
  fingerprintWgpuTransformPayload,
  parseCssRgbColor,
  shouldSubmitVisibleWgpuTransform,
  WGPU_HIDDEN_COORDINATE,
} from '../../../src/utils/wgpuTransformPayload';

const colors = {
  bgPrimary: [24 / 255, 24 / 255, 24 / 255, 1] as const,
  bgSecondary: [35 / 255, 35 / 255, 35 / 255, 1] as const,
};

const rect = {
  left: 10,
  top: 20,
  width: 300,
  height: 200,
};

describe('wgpu transform payload', () => {
  test('submits visible geometry before the first native frame receipt', () => {
    expect(shouldSubmitVisibleWgpuTransform(true, true)).toBe(true);
    expect(shouldSubmitVisibleWgpuTransform(true, false)).toBe(false);
    expect(shouldSubmitVisibleWgpuTransform(false, true)).toBe(false);
  });

  test('parses CSS rgb colors into normalized RGBA tuples', () => {
    expect(parseCssRgbColor('rgb(24, 36, 48)')).toEqual([24 / 255, 36 / 255, 48 / 255, 1]);
    expect(parseCssRgbColor('not-a-color')).toEqual([0, 0, 0, 1]);
  });

  test('builds the hidden sentinel payload without enabling pixelated preview', () => {
    const payload = buildHiddenWgpuTransformPayload(
      {
        containerRect: rect,
        dpr: 2,
        windowWidth: 1600,
        windowHeight: 1200,
      },
      colors,
    );

    expect(payload).toMatchObject({
      windowWidth: 1600,
      windowHeight: 1200,
      x: WGPU_HIDDEN_COORDINATE,
      y: WGPU_HIDDEN_COORDINATE,
      width: 1,
      height: 1,
      clipX: 16,
      clipY: 36,
      clipWidth: 608,
      clipHeight: 408,
      pixelated: false,
    });
  });

  test('builds visible screen geometry from transform and render offsets', () => {
    const payload = buildVisibleWgpuTransformPayload(
      {
        containerRect: rect,
        dpr: 2,
        windowWidth: 1600,
        windowHeight: 1200,
        maxScale: 20,
        transformState: { scale: 1.5, positionX: 7, positionY: 11 },
        imageRenderSize: {
          width: 120,
          height: 80,
          offsetX: 4,
          offsetY: 6,
          containerWidth: 300,
          containerHeight: 200,
          scale: 1,
        },
      },
      colors,
      false,
    );

    expect(payload).toMatchObject({
      x: 46,
      y: 80,
      width: 360,
      height: 240,
      pixelated: false,
    });
  });

  test('hides visible payload geometry while crop view owns the image surface', () => {
    const payload = buildVisibleWgpuTransformPayload(
      {
        containerRect: rect,
        dpr: 1,
        windowWidth: 800,
        windowHeight: 600,
        maxScale: 5,
        transformState: { scale: 4.75, positionX: 0, positionY: 0 },
        imageRenderSize: {
          width: 0,
          height: 0,
          offsetX: 0,
          offsetY: 0,
          containerWidth: 300,
          containerHeight: 200,
          scale: 1,
        },
      },
      colors,
      true,
    );

    expect(payload).toMatchObject({
      x: WGPU_HIDDEN_COORDINATE,
      y: WGPU_HIDDEN_COORDINATE,
      width: 1,
      height: 1,
      pixelated: true,
    });
  });

  test('fingerprint preserves the existing transform de-dupe fields', () => {
    const payload = buildHiddenWgpuTransformPayload(
      {
        containerRect: rect,
        dpr: 1,
        windowWidth: 800,
        windowHeight: 600,
      },
      colors,
    );

    expect(fingerprintWgpuTransformPayload(payload)).toBe(
      '800,600,-999999,-999999,1,1,8,18,304,204,0.09411764705882353,0.09411764705882353,0.09411764705882353,1,0.13725490196078433,0.13725490196078433,0.13725490196078433,1',
    );
  });
});
