import { describe, expect, test } from 'bun:test';
import {
  EDITOR_ZOOM_STEP_LADDER,
  type EditorZoomMode,
  formatEditorZoomLabel,
  getEditorZoomModeForCommand,
  getEditorZoomModeForTransformScale,
  getEditorZoomResolutionState,
  getEditorZoomSourceSize,
  isEditorPixelInspectionZoom,
  resolveEditorZoom,
} from '../../../src/utils/editorZoom.ts';

const sourceSize = { height: 4000, width: 6000 };

const resolve = (mode: EditorZoomMode, overrides: Partial<Parameters<typeof resolveEditorZoom>[0]> = {}) =>
  resolveEditorZoom({
    devicePixelRatio: 1,
    mode,
    renderSize: { height: 600, scale: 0.15, width: 900 },
    sourceSize,
    viewportSize: { height: 600, width: 1000 },
    ...overrides,
  });

describe('editor zoom contract', () => {
  test('maps one source pixel to one physical pixel at every supported DPR', () => {
    for (const devicePixelRatio of [1, 1.25, 1.5, 2]) {
      const resolved = resolve({ devicePixelsPerImagePixel: 1, kind: 'ratio' }, { devicePixelRatio });

      expect(resolved.devicePixelsPerImagePixel).toBeCloseTo(1);
      expect(resolved.imagePixelsPerDevicePixel).toBeCloseTo(1);
      expect(resolved.transformScale * 0.15 * devicePixelRatio).toBeCloseTo(1);
      expect(resolved.displayPercent).toBe(100);
    }
  });

  test('promotes gesture transforms into semantic ratio modes without changing visible scale', () => {
    for (const devicePixelRatio of [1, 1.5, 2]) {
      for (const renderScale of [0.12, 0.5, 1]) {
        for (const devicePixelsPerImagePixel of [0.1, 0.5, 2, 4]) {
          const transformScale = devicePixelsPerImagePixel / (devicePixelRatio * renderScale);
          const mode = getEditorZoomModeForTransformScale({
            devicePixelRatio,
            renderScale,
            transformScale,
          });
          const resolved = resolveEditorZoom({
            devicePixelRatio,
            mode,
            renderSize: { height: 4000 * renderScale, scale: renderScale, width: 6000 * renderScale },
            sourceSize,
            viewportSize: { height: 600, width: 1000 },
          });

          expect(mode.kind).toBe('ratio');
          expect(resolved.transformScale).toBeCloseTo(transformScale, 8);
          expect(resolved.devicePixelsPerImagePixel).toBeCloseTo(devicePixelsPerImagePixel, 8);
        }
      }
    }
  });

  test('resolves fit, fill, and ratio modes from shared geometry', () => {
    const fit = resolve({ kind: 'fit' });
    const fill = resolve({ kind: 'fill' });
    const twoToOne = resolve({ devicePixelsPerImagePixel: 2, kind: 'ratio' });

    expect(fit.transformScale).toBe(1);
    expect(fill.transformScale).toBeCloseTo(1.1111111111);
    expect(twoToOne.transformScale).toBeCloseTo(13.3333333333);
    expect(twoToOne.displayPercent).toBe(200);
    expect(twoToOne.requiredPreviewResolution).toBe(6000);
  });

  test('preserves semantic modes while crop, orientation, and viewport geometry change', () => {
    const modes: EditorZoomMode[] = [
      { kind: 'fit' },
      { kind: 'fill' },
      { devicePixelsPerImagePixel: 1, kind: 'ratio' },
      { devicePixelsPerImagePixel: 2, kind: 'ratio' },
    ];

    for (const mode of modes) {
      const before = resolve(mode, { devicePixelRatio: 1 });
      const after = resolve(mode, {
        devicePixelRatio: 2,
        renderSize: { height: 720, scale: 0.24, width: 1080 },
        sourceSize: { height: 3000, width: 4500 },
        viewportSize: { height: 900, width: 800 },
      });

      expect(after.mode).toEqual(mode);
      if (mode.kind === 'ratio') {
        expect(after.devicePixelsPerImagePixel).toBe(mode.devicePixelsPerImagePixel);
        expect(after.transformScale).not.toBe(before.transformScale);
      } else if (mode.kind === 'fit') {
        expect(after.transformScale).toBe(1);
      } else {
        expect(after.transformScale).not.toBe(before.transformScale);
      }
    }
  });

  test('centralizes the command ladder and semantic cycle', () => {
    const fit = resolve({ kind: 'fit' });
    expect(getEditorZoomModeForCommand({ direction: 'in', kind: 'step' }, fit)).toEqual({
      devicePixelsPerImagePixel: EDITOR_ZOOM_STEP_LADDER[0],
      kind: 'ratio',
    });

    const oneToOne = resolve({ devicePixelsPerImagePixel: 1, kind: 'ratio' });
    expect(getEditorZoomModeForCommand({ direction: 'in', kind: 'step' }, oneToOne)).toEqual({
      devicePixelsPerImagePixel: 1.5,
      kind: 'ratio',
    });
    expect(getEditorZoomModeForCommand({ kind: 'cycle' }, fit)).toEqual({
      devicePixelsPerImagePixel: 1,
      kind: 'ratio',
    });
    expect(getEditorZoomModeForCommand({ kind: 'cycle' }, oneToOne)).toEqual({
      devicePixelsPerImagePixel: 2,
      kind: 'ratio',
    });
    expect(
      getEditorZoomModeForCommand(
        { direction: 'out', kind: 'step' },
        resolve({
          devicePixelsPerImagePixel: 0.25,
          kind: 'ratio',
        }),
      ),
    ).toEqual({ kind: 'fit' });
  });

  test('formats semantic labels and reports unavailable preview detail honestly', () => {
    const fit = resolve({ kind: 'fit' });
    const twoToOne = resolve({ devicePixelsPerImagePixel: 2, kind: 'ratio' });

    expect(formatEditorZoomLabel(fit, { fill: 'Fill', fit: 'Fit' })).toBe('Fit');
    expect(formatEditorZoomLabel(twoToOne, { fill: 'Fill', fit: 'Fit' })).toBe('200%');
    expect(
      getEditorZoomResolutionState({
        renderedPreviewResolution: 4000,
        requestedPreviewResolution: 6000,
        resolvedZoom: twoToOne,
      }),
    ).toBe('settling');
    expect(
      getEditorZoomResolutionState({
        renderedPreviewResolution: 6000,
        requestedPreviewResolution: 4000,
        resolvedZoom: twoToOne,
      }),
    ).toBe('limited');
    expect(isEditorPixelInspectionZoom(twoToOne)).toBe(true);
  });

  test('uses crops and rotated source dimensions before resolving zoom', () => {
    expect(
      getEditorZoomSourceSize({
        crop: { height: 1800, width: 2400 },
        orientationSteps: 1,
        originalSize: sourceSize,
      }),
    ).toEqual({ height: 1800, width: 2400 });
    expect(getEditorZoomSourceSize({ crop: null, orientationSteps: 1, originalSize: sourceSize })).toEqual({
      height: 6000,
      width: 4000,
    });
  });
});
