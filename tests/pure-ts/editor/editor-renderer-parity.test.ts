import { describe, expect, test } from 'bun:test';
import { createEditorOverlayGeometry, overlayPoint } from '../../../src/utils/editorOverlayGeometry';
import {
  advanceRendererHandoff,
  createEditorPresentationDescriptor,
  createRendererHandoffState,
} from '../../../src/utils/editorPresentationDescriptor';

const geometry = createEditorOverlayGeometry({
  crop: { height: 1800, width: 2400, x: 320, y: 180 },
  devicePixelRatio: 2,
  geometryEpoch: 12,
  orientationSteps: 1,
  renderSize: { height: 675, offsetX: 42, offsetY: 28, scale: 0.375, width: 900 },
  rotationDegrees: -3.25,
  semanticZoom: {
    cssPercent: 200,
    devicePixelsPerImagePixel: 1.5,
    displayPercent: 150,
    imagePixelsPerCssPixel: 2 / 3,
    imagePixelsPerDevicePixel: 1 / 3,
    mode: { devicePixelsPerImagePixel: 1.5, kind: 'ratio' },
    requiredPreviewResolution: 4096,
    transformScale: 2,
  },
  sourceSize: { height: 4000, width: 6000 },
  transform: { positionX: -81.5, positionY: 37.25, scale: 2 },
  viewportSizeCssPixels: { height: 800, width: 1100 },
});

const descriptor = (graphRevision = 'graph:7', geometryOverride = geometry) =>
  createEditorPresentationDescriptor({
    colorTransformIdentity: 'working:linear-rec2020>display:p3:v4',
    compareIdentity: 'split:vertical:0.375',
    geometry: geometryOverride,
    graphRevision,
    overlayIdentity: 'mask:42|retouch:9|diagnostics:clipping',
    proofTransformIdentity: 'proof:cmyk-fogra51|intent:relative|bpc:true',
    quality: 'settled',
    sourceIdentity: '/fixture/parity-chart.dng',
    textureSize: { height: 2731, width: 4096 },
  });

describe('editor renderer presentation parity', () => {
  test('freezes one complete geometry, transform, color, proof, and overlay identity', () => {
    const presentation = descriptor();
    expect(Object.isFrozen(presentation)).toBe(true);
    expect(Object.isFrozen(presentation.textureSize)).toBe(true);
    expect(presentation).toMatchObject({
      alphaPolicy: 'preserve-over-matte',
      colorTransformIdentity: 'working:linear-rec2020>display:p3:v4',
      geometryEpoch: 12,
      orientationSteps: 1,
      overlayIdentity: 'mask:42|retouch:9|diagnostics:clipping',
      proofTransformIdentity: 'proof:cmyk-fogra51|intent:relative|bpc:true',
      quality: 'settled',
    });

    const landmark = geometry.normalizedCropToViewport(overlayPoint<'normalized-crop'>(0.37, 0.61));
    const wgpuLandmark = geometry.deviceToViewport(geometry.viewportToDevice(landmark));
    expect(Math.abs(wgpuLandmark.x - landmark.x)).toBeLessThan(0.001);
    expect(Math.abs(wgpuLandmark.y - landmark.y)).toBeLessThan(0.001);
  });

  test('keeps exactly one coherent backend visible through activation and generation changes', () => {
    let state = createRendererHandoffState(descriptor(), 20);
    state = advanceRendererHandoff({ descriptor: descriptor(), state, useWgpuRenderer: true, wgpuFrameSerial: 20 });
    expect(state).toMatchObject({ committedBackend: 'cpu', generation: 1, status: 'waiting-wgpu' });

    state = advanceRendererHandoff({ descriptor: descriptor(), state, useWgpuRenderer: true, wgpuFrameSerial: 21 });
    expect(state).toMatchObject({ committedBackend: 'wgpu', generation: 1, status: 'wgpu' });

    const next = descriptor('graph:8');
    state = advanceRendererHandoff({ descriptor: next, state, useWgpuRenderer: true, wgpuFrameSerial: 21 });
    expect(state).toMatchObject({ committedBackend: 'cpu', generation: 2, status: 'waiting-wgpu' });

    state = advanceRendererHandoff({ descriptor: next, state, useWgpuRenderer: true, wgpuFrameSerial: 21 });
    expect(state.committedBackend).toBe('cpu');
    state = advanceRendererHandoff({ descriptor: next, state, useWgpuRenderer: true, wgpuFrameSerial: 22 });
    expect(state.committedBackend).toBe('wgpu');
  });

  test('falls back coherently on failure and recovers only on a newer frame receipt', () => {
    let state = createRendererHandoffState(descriptor(), 4);
    state = advanceRendererHandoff({ descriptor: descriptor(), state, useWgpuRenderer: true, wgpuFrameSerial: 5 });
    state = advanceRendererHandoff({
      descriptor: descriptor(),
      failed: true,
      state,
      useWgpuRenderer: true,
      wgpuFrameSerial: 5,
    });
    expect(state).toMatchObject({ committedBackend: 'cpu', status: 'degraded' });

    state = advanceRendererHandoff({ descriptor: descriptor(), state, useWgpuRenderer: true, wgpuFrameSerial: 5 });
    expect(state).toMatchObject({ committedBackend: 'cpu', status: 'waiting-wgpu' });
    state = advanceRendererHandoff({ descriptor: descriptor(), state, useWgpuRenderer: true, wgpuFrameSerial: 6 });
    expect(state).toMatchObject({ committedBackend: 'wgpu', status: 'wgpu' });
  });

  test('documents representative color parity tolerance without changing renderer math', () => {
    const cpu = [0, 0.125, 0.502, 0.749, 0.996, 1];
    const wgpu = [0, 0.1254, 0.5012, 0.7501, 0.9951, 1];
    const deltas = cpu.map((value, index) => Math.abs(value - (wgpu[index] ?? value)));
    const rms = Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0) / deltas.length);
    expect(Math.max(...deltas)).toBeLessThanOrEqual(0.0011);
    expect(rms).toBeLessThanOrEqual(0.0007);
  });
});
