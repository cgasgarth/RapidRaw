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
  onOriginalPresented: (url: string) => void;
  showOriginalCompare: boolean;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
  showFrameShadow: boolean;
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
  onOriginalPresented,
  showOriginalCompare,
  showSideBySideCompare,
  showSplitCompare,
  showFrameShadow,
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
          {[imageRenderSize, ...(isPaired ? [originalImageRenderSize] : [])].map((rect, index) => (
            <div
              aria-hidden="true"
              className="pointer-events-none border border-editor-overlay-stroke"
              data-editor-image-frame={index === 0 ? 'edited' : 'original'}
              data-editor-image-shadow={String(showFrameShadow)}
              key={index === 0 ? 'edited' : 'original'}
              style={{
                ...renderRectStyle(rect),
                boxShadow: showFrameShadow ? '0 20px 44px var(--editor-image-shadow)' : 'none',
                zIndex: imageCanvasLayerZIndex('imageFrame'),
              }}
            />
          ))}
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
              onLoad={() => onOriginalPresented(originalSrc)}
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
