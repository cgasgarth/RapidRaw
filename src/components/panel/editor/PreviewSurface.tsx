import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

interface PreviewSurfaceProps {
  children: ReactNode;
  imageRenderSize: RenderSize;
  isCropViewVisible: boolean;
  isMaxZoom: boolean | undefined;
  originalLoaded: boolean;
  originalSrc: string | null;
  showOriginalCompare: boolean;
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
  svgPreview: ReactNode;
}

const cssPx = (value: number): string => `${String(value)}px`;

export function PreviewSurface({
  children,
  imageRenderSize,
  isCropViewVisible,
  isMaxZoom,
  originalLoaded,
  originalSrc,
  showOriginalCompare,
  showSideBySideCompare,
  showSplitCompare,
  svgPreview,
}: PreviewSurfaceProps) {
  const { t } = useTranslation();
  const hasSizedImage = imageRenderSize.width > 0 && imageRenderSize.height > 0;
  const originalStyle: CSSProperties = {
    clipPath: showSplitCompare ? 'inset(0 50% 0 0)' : undefined,
    imageRendering: isMaxZoom ? 'pixelated' : 'auto',
    opacity: (showOriginalCompare || showSplitCompare) && originalLoaded && !showSideBySideCompare ? 1 : 0,
    transition: originalLoaded ? 'opacity 150ms ease-in-out' : 'none',
    zIndex: imageCanvasLayerZIndex('comparisonReveal'),
  };

  return (
    <div
      className="absolute inset-0 w-full h-full transition-opacity duration-200 flex items-center justify-center"
      style={{ opacity: isCropViewVisible ? 0 : 1, pointerEvents: isCropViewVisible ? 'none' : 'auto' }}
    >
      <div className="opacity-100" style={{ height: '100%', position: 'relative', width: '100%' }}>
        <div className="absolute inset-0 w-full h-full">
          <svg
            className="pointer-events-none"
            preserveAspectRatio={hasSizedImage ? 'none' : 'xMidYMid meet'}
            style={
              hasSizedImage
                ? {
                    height: cssPx(imageRenderSize.height),
                    left: cssPx(imageRenderSize.offsetX),
                    overflow: 'visible',
                    position: 'absolute',
                    top: cssPx(imageRenderSize.offsetY),
                    width: cssPx(imageRenderSize.width),
                  }
                : { height: '100%', inset: '0px', overflow: 'visible', position: 'absolute', width: '100%' }
            }
          >
            {svgPreview}
          </svg>
          {originalSrc && (
            <img
              alt={t('editor.canvas.originalAlt')}
              className={
                hasSizedImage
                  ? 'pointer-events-none'
                  : 'absolute inset-0 w-full h-full object-contain pointer-events-none'
              }
              src={originalSrc}
              style={
                hasSizedImage
                  ? {
                      ...originalStyle,
                      height: cssPx(imageRenderSize.height),
                      left: cssPx(imageRenderSize.offsetX),
                      position: 'absolute',
                      top: cssPx(imageRenderSize.offsetY),
                      width: cssPx(imageRenderSize.width),
                    }
                  : originalStyle
              }
            />
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
