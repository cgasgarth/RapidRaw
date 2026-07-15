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

  if (requiresCpuComposition) {
    return { health: 'cpu-composition', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
  }

  if (currentFrameHealth === 'fresh') {
    return { health: 'fresh', previewBackend: 'wgpu', shouldHideCpuPreview: true };
  }

  return { health: 'pending-frame-health', previewBackend: 'cpu-fallback', shouldHideCpuPreview: false };
};
