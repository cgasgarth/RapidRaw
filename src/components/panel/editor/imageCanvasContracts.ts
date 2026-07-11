export const imageCanvasLayer = {
  imageFrame: 0,
  preview: 1,
  comparisonReveal: 2,
  diagnosticPixels: 3,
  maskCoverage: 4,
  toolGeometry: 5,
  activeTool: 6,
  viewerHud: 7,
} as const;

export type ImageCanvasLayer = keyof typeof imageCanvasLayer;

export const imageCanvasLayerZIndex = (layer: ImageCanvasLayer): number => imageCanvasLayer[layer];

export type ImageCanvasPointerOwner = 'active-tool' | 'crop' | 'pan-zoom';

export type ViewerChromeLayout = 'compact' | 'desktop' | 'fullscreen';

export interface ViewerChromeRegionContract {
  layout: ViewerChromeLayout;
  persistentControlPlacement: 'outside-image';
}

export const resolveViewerChromeRegionContract = ({
  isCompact,
  isFullScreen,
}: {
  isCompact: boolean;
  isFullScreen: boolean;
}): ViewerChromeRegionContract => ({
  layout: isFullScreen ? 'fullscreen' : isCompact ? 'compact' : 'desktop',
  persistentControlPlacement: 'outside-image',
});

export interface ResolveImageCanvasPointerOwnerInput {
  isCropping: boolean;
  isMaskInteractionActive: boolean;
  isToolActive: boolean;
  pointerButton?: number | undefined;
}

// Middle-click remains a temporary pan gesture even while another tool is active.
export const resolveImageCanvasPointerOwner = ({
  isCropping,
  isMaskInteractionActive,
  isToolActive,
  pointerButton,
}: ResolveImageCanvasPointerOwnerInput): ImageCanvasPointerOwner => {
  if (pointerButton === 1) return 'pan-zoom';
  if (isCropping) return 'crop';
  if (isToolActive || isMaskInteractionActive) return 'active-tool';
  return 'pan-zoom';
};

export const resolveEffectiveBrushTool = (
  canonicalTool: 'brush' | 'eraser',
  isAltPressed: boolean,
): 'brush' | 'eraser' => {
  if (!isAltPressed) return canonicalTool;
  return canonicalTool === 'brush' ? 'eraser' : 'brush';
};

export const resolveCropPreviewVisibility = ({
  cropPreviewUrl,
  isCropping,
  loadedCropPreviewUrl,
}: {
  cropPreviewUrl: string | null;
  isCropping: boolean;
  loadedCropPreviewUrl: string | null;
}): boolean => isCropping && cropPreviewUrl !== null && loadedCropPreviewUrl === cropPreviewUrl;

export const resolveDisplayedMaskUrl = ({
  isAiEditing,
  isMasking,
  maskOverlayUrl,
}: {
  isAiEditing: boolean;
  isMasking: boolean;
  maskOverlayUrl: string | null;
}): string | null => (isMasking || isAiEditing ? maskOverlayUrl : null);
