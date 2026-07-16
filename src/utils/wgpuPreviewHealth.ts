export type WgpuPreviewHealth =
  | 'disabled'
  | 'waiting-image'
  | 'waiting-first-frame'
  | 'missing-cpu-preview'
  | 'pending-frame-health'
  | 'cpu-composition'
  | 'fresh';

export interface WgpuPreviewHealthInput {
  currentFrameHealth?: 'fresh' | null | undefined;
  hasRenderedFirstFrame: boolean;
  /**
   * Native WGPU receipts prove the source texture, but not that a transformed
   * viewport is visible after the canvas transform has changed. Keep the
   * current CPU layer in place until that compositor path has its own proof.
   */
  hasViewportTransform?: boolean | undefined;
  previewSource: string | null | undefined;
  requiresCpuComposition?: boolean | undefined;
  selectedImageIsReady: boolean;
  useWgpuRenderer: boolean | undefined;
}

export interface WgpuPreviewVisibility {
  health: WgpuPreviewHealth;
  previewBackend: 'cpu' | 'cpu-fallback' | 'wgpu';
  shouldHideCpuPreview: boolean;
}

export const resolveWgpuPreviewVisibility = ({
  currentFrameHealth,
  hasRenderedFirstFrame,
  hasViewportTransform = false,
  previewSource,
  requiresCpuComposition = false,
  selectedImageIsReady,
  useWgpuRenderer,
}: WgpuPreviewHealthInput): WgpuPreviewVisibility => {
  if (useWgpuRenderer !== true) {
    return { health: 'disabled', previewBackend: 'cpu', shouldHideCpuPreview: false };
  }

  if (!selectedImageIsReady) {
    return { health: 'waiting-image', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
  }

  if (!hasRenderedFirstFrame) {
    return { health: 'waiting-first-frame', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
  }

  if (!previewSource) {
    return { health: 'missing-cpu-preview', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
  }

  if (requiresCpuComposition || hasViewportTransform) {
    return { health: 'cpu-composition', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
  }

  if (currentFrameHealth === 'fresh') {
    return { health: 'fresh', previewBackend: 'wgpu', shouldHideCpuPreview: true };
  }

  return { health: 'pending-frame-health', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
};
