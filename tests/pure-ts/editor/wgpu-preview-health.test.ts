import { describe, expect, it } from 'bun:test';
import { resolveWgpuPreviewVisibility } from '../../../src/utils/wgpuPreviewHealth.ts';

describe('resolveWgpuPreviewVisibility', () => {
  it('keeps the CPU preview visible when WGPU is disabled', () => {
    expect(
      resolveWgpuPreviewVisibility({
        hasRenderedFirstFrame: true,
        previewSource: 'blob:preview',
        selectedImageIsReady: true,
        useWgpuRenderer: false,
      }),
    ).toEqual({
      health: 'disabled',
      previewBackend: 'cpu',
      shouldHideCpuPreview: false,
    });
  });

  it('keeps the CPU preview visible while WGPU frame health is pending', () => {
    expect(
      resolveWgpuPreviewVisibility({
        hasRenderedFirstFrame: true,
        previewSource: 'blob:preview',
        selectedImageIsReady: true,
        useWgpuRenderer: true,
      }),
    ).toEqual({
      health: 'pending-frame-health',
      previewBackend: 'cpu-fallback',
      shouldHideCpuPreview: false,
    });
  });

  it('hides CPU only for a fresh WGPU frame receipt', () => {
    expect(
      resolveWgpuPreviewVisibility({
        currentFrameHealth: 'fresh',
        hasRenderedFirstFrame: true,
        previewSource: 'blob:preview',
        selectedImageIsReady: true,
        useWgpuRenderer: true,
      }),
    ).toEqual({
      health: 'fresh',
      previewBackend: 'wgpu',
      shouldHideCpuPreview: true,
    });
  });

  it('does not hide CPU when the current preview source is missing', () => {
    expect(
      resolveWgpuPreviewVisibility({
        hasRenderedFirstFrame: true,
        previewSource: null,
        selectedImageIsReady: true,
        useWgpuRenderer: true,
      }),
    ).toEqual({
      health: 'missing-cpu-preview',
      previewBackend: 'cpu-fallback',
      shouldHideCpuPreview: false,
    });
  });
});
