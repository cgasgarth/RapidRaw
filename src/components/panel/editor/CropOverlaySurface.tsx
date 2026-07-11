import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import CropOverlay, { type Crop, type PercentCrop } from 'react-image-crop';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { OverlayMode } from '../right/color/CropPanel';
import CompositionOverlays from './overlays/CompositionOverlays';

interface CropOverlaySurfaceProps {
  aspectRatio: number | null;
  crop: Crop | null;
  cropImageRef: RefObject<HTMLImageElement | null>;
  cropImageTransform: string;
  cropPreviewUrl: string | null;
  cropRenderSize: { height?: number; width?: number } | null;
  geometry: EditorOverlayGeometry;
  handleCropComplete: (crop: Crop, percentCrop: PercentCrop) => void;
  handleCropStart: () => void;
  isCropping: boolean;
  isCropViewVisible: boolean;
  isMaxZoom: boolean | undefined;
  isRotationActive: boolean | undefined;
  isStraightenActive: boolean;
  overlayMode: OverlayMode | undefined;
  overlayRotation: number | undefined;
  setCrop: (crop: Crop, percentCrop: PercentCrop) => void;
  straightenOverlay: ReactNode;
}

const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;

export function CropOverlaySurface({
  aspectRatio,
  crop,
  cropImageRef,
  cropImageTransform,
  cropPreviewUrl,
  cropRenderSize,
  geometry,
  handleCropComplete,
  handleCropStart,
  isCropping,
  isCropViewVisible,
  isMaxZoom,
  isRotationActive,
  isStraightenActive,
  overlayMode,
  overlayRotation,
  setCrop,
  straightenOverlay,
}: CropOverlaySurfaceProps) {
  const { t } = useTranslation();
  const cropCanvasRatioLabel =
    aspectRatio === null ? t('editor.crop.presets.free.name') : `${aspectRatio.toFixed(2)}:1`;
  const cropCanvasOverlayLabel = isStraightenActive ? t('editor.crop.rotationHeading') : overlayMode || 'none';
  const cropWidth = cropRenderSize?.width;
  const cropHeight = cropRenderSize?.height;

  const getCropDimensions = () => {
    if (!crop || !cropWidth || !cropHeight) return { height: 0, width: 0 };
    return {
      height: crop.unit === '%' ? cropHeight * (crop.height / 100) : crop.height,
      width: crop.unit === '%' ? cropWidth * (crop.width / 100) : crop.width,
    };
  };

  return (
    <div
      className="absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-200"
      data-overlay-geometry-epoch={geometry.geometryEpoch}
      data-overlay-geometry-space="oriented-pixels"
      style={{ opacity: isCropViewVisible ? 1 : 0, pointerEvents: isCropViewVisible ? 'auto' : 'none' }}
    >
      {isCropping && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-hidden text-[11px]"
          data-crop-canvas-overlay={cropCanvasOverlayLabel}
          data-crop-canvas-ratio={cropCanvasRatioLabel}
          data-testid="crop-canvas-mode-strip"
        >
          <span className="shrink-0 rounded border border-editor-overlay-stroke bg-editor-panel/92 px-1.5 py-1 text-text-primary shadow-sm backdrop-blur">
            {t('editor.crop.title')}
          </span>
          <span className="truncate rounded border border-editor-overlay-stroke bg-editor-panel/92 px-1.5 py-1 font-mono text-text-secondary shadow-sm backdrop-blur">
            {cropCanvasRatioLabel}
          </span>
        </div>
      )}
      {cropPreviewUrl && cropRenderSize && (
        <div onPointerDown={handleCropStart} style={{ height: cropHeight, position: 'relative', width: cropWidth }}>
          <CropOverlay
            aspect={aspectRatio}
            crop={crop}
            onChange={setCrop}
            onComplete={handleCropComplete}
            ruleOfThirds={false}
            renderSelectionAddon={() => {
              const { height, width } = getCropDimensions();
              if (width <= 0 || height <= 0) return null;
              const denseVisible = Boolean(isRotationActive && !isStraightenActive);
              const mode = isRotationActive || isStraightenActive ? 'none' : overlayMode || 'none';
              return (
                <CompositionOverlays
                  denseVisible={denseVisible}
                  height={height}
                  mode={mode}
                  rotation={overlayRotation || 0}
                  width={width}
                />
              );
            }}
          >
            <img
              alt={t('editor.canvas.cropPreviewAlt')}
              ref={cropImageRef}
              src={cropPreviewUrl}
              style={{
                display: 'block',
                height: cssPx(cropHeight),
                imageRendering: isMaxZoom ? 'pixelated' : 'auto',
                objectFit: 'contain',
                transform: cropImageTransform,
                width: cssPx(cropWidth),
              }}
            />
          </CropOverlay>
          {straightenOverlay}
        </div>
      )}
    </div>
  );
}
