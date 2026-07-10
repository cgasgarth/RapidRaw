import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import {
  type EditorCompareMode,
  type EditorCompareOrientation,
  resolveCompareDividerGeometry,
} from '../../../utils/editorCompare';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

interface PreviewSurfaceProps {
  children: ReactNode;
  compareDividerPosition: number;
  compareMode: EditorCompareMode;
  compareOrientation: EditorCompareOrientation;
  imageRenderSize: RenderSize;
  isCropViewVisible: boolean;
  isMaxZoom: boolean | undefined;
  originalImageRenderSize: RenderSize;
  originalLoaded: boolean;
  originalSrc: string | null;
  showOriginalCompare: boolean;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
  svgPreview: ReactNode;
}

const cssPx = (value: number): string => `${String(value)}px`;
const renderRectStyle = (rect: RenderSize): CSSProperties => ({
  height: cssPx(rect.height),
  left: cssPx(rect.offsetX),
  position: 'absolute',
  top: cssPx(rect.offsetY),
  width: cssPx(rect.width),
});

export function PreviewSurface({
  children,
  compareDividerPosition,
  compareMode,
  compareOrientation,
  imageRenderSize,
  isCropViewVisible,
  isMaxZoom,
  originalImageRenderSize,
  originalLoaded,
  originalSrc,
  showOriginalCompare,
  showSideBySideCompare,
  showSplitCompare,
  svgPreview,
}: PreviewSurfaceProps) {
  const { t } = useTranslation();
  const hasSizedImage = imageRenderSize.width > 0 && imageRenderSize.height > 0;
  const isPaired = compareMode === 'side-by-side' && showSideBySideCompare;
  const divider = resolveCompareDividerGeometry({
    dividerPosition: compareDividerPosition,
    imageRect: imageRenderSize,
    orientation: compareOrientation,
  });
  const originalRect = isPaired ? originalImageRenderSize : imageRenderSize;
  const originalStyle: CSSProperties = {
    ...renderRectStyle(originalRect),
    clipPath: showSplitCompare ? divider.clipPath : undefined,
    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
    opacity: (showOriginalCompare || showSplitCompare || isPaired) && originalLoaded ? 1 : 0,
    transition: originalLoaded ? 'opacity 150ms ease-in-out' : 'none',
    zIndex: imageCanvasLayerZIndex(isPaired ? 'preview' : 'comparisonReveal'),
  };

  return (
    <div
      className="absolute inset-0 flex h-full w-full items-center justify-center transition-opacity duration-200"
      style={{ opacity: isCropViewVisible ? 0 : 1, pointerEvents: isCropViewVisible ? 'none' : 'auto' }}
    >
      <div className="relative h-full w-full opacity-100">
        <div className="absolute inset-0 h-full w-full">
          <svg
            className="pointer-events-none"
            preserveAspectRatio={hasSizedImage ? 'none' : 'xMidYMid meet'}
            style={
              hasSizedImage
                ? { ...renderRectStyle(imageRenderSize), overflow: 'visible' }
                : { height: '100%', inset: '0px', overflow: 'visible', position: 'absolute', width: '100%' }
            }
          >
            {svgPreview}
          </svg>
          {originalSrc && (
            <img
              alt={t('editor.canvas.originalAlt')}
              className={hasSizedImage ? 'pointer-events-none' : 'absolute inset-0 h-full w-full object-contain'}
              src={originalSrc}
              style={hasSizedImage ? originalStyle : { ...originalStyle, inset: '0px', objectFit: 'contain' }}
            />
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
