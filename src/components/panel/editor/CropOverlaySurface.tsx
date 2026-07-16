import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import CropOverlay, { type Crop, type PercentCrop } from 'react-image-crop';
import type { OverlayMode } from '../right/color/CropPanel';
import type { CropGeometryOverlayDescriptor } from './cropStraightenController';
import CompositionOverlays from './overlays/CompositionOverlays';

interface CropOverlaySurfaceProps {
  aspectRatio: number | null;
  crop: Crop | null;
  cropImageRef: RefObject<HTMLImageElement | null>;
  cropImageTransform: string;
  cropPreviewUrl: string | null;
  descriptor: CropGeometryOverlayDescriptor | null;
  handleCropComplete: (crop: Crop, percentCrop: PercentCrop) => void;
  isCropping: boolean;
  isCropViewVisible: boolean;
  onCropPreviewError: () => void;
  onCropPreviewLoad: () => void;
  isMaxZoom: boolean | undefined;
  isRotationActive: boolean | undefined;
  isStraightenActive: boolean;
  overlayMode: OverlayMode | undefined;
  overlayRotation: number | undefined;
  setCrop: (crop: Crop, percentCrop: PercentCrop) => void;
}

const cssPx = (value: number | undefined): string => `${String(value ?? 0)}px`;
const emptyCrop: PercentCrop = { height: 0, unit: '%', width: 0, x: 0, y: 0 };

export function CropOverlaySurface({
  aspectRatio,
  crop,
  cropImageRef,
  cropImageTransform,
  cropPreviewUrl,
  descriptor,
  handleCropComplete,
  isCropping,
  isCropViewVisible,
  onCropPreviewError,
  onCropPreviewLoad,
  isMaxZoom,
  isRotationActive,
  isStraightenActive,
  overlayMode,
  overlayRotation,
  setCrop,
}: CropOverlaySurfaceProps) {
  const { t } = useTranslation();
  const cropCanvasRatioLabel =
    aspectRatio === null ? t('editor.crop.presets.free.name') : `${aspectRatio.toFixed(2)}:1`;
  const cropCanvasOverlayLabel = isStraightenActive ? t('editor.crop.rotationHeading') : overlayMode || 'none';
  const cropWidth = descriptor?.renderSize.width;
  const cropHeight = descriptor?.renderSize.height;

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
      data-controller-installed-tool={descriptor?.tool}
      data-controller-image-session={descriptor?.sessionKey.imageSessionId}
      data-controller-operation-generation={descriptor?.sessionKey.operationGeneration}
      data-controller-session={descriptor?.sessionFingerprint}
      data-controller-source-identity={descriptor?.sessionKey.sourceIdentity}
      data-controller-source-revision={descriptor?.sessionKey.sourceRevision}
      data-controller-tool={descriptor?.tool}
      data-crop-view-visible={String(isCropViewVisible)}
      data-overlay-geometry-epoch={descriptor?.geometryEpoch}
      data-overlay-geometry-space="oriented-pixels"
      data-testid="crop-overlay-surface"
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
      {cropPreviewUrl && descriptor && (
        <div
          data-viewer-input-tool={descriptor.tool}
          style={{ height: cropHeight, position: 'relative', width: cropWidth }}
        >
          <CropOverlay
            aspect={aspectRatio}
            crop={crop ?? emptyCrop}
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
              onError={onCropPreviewError}
              onLoad={onCropPreviewLoad}
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
          {isStraightenActive && (
            <div
              aria-label={t('editor.crop.tooltips.straighten')}
              className="absolute inset-0"
              data-controller-geometry-epoch={descriptor.geometryEpoch}
              data-controller-session={descriptor.sessionFingerprint}
              data-controller-image-session={descriptor.sessionKey.imageSessionId}
              data-controller-operation-generation={descriptor.sessionKey.operationGeneration}
              data-controller-source-identity={descriptor.sessionKey.sourceIdentity}
              data-controller-source-revision={descriptor.sessionKey.sourceRevision}
              data-testid="crop-straighten-input-surface"
              data-viewer-input-tool="straighten"
              role="application"
              style={{ cursor: 'crosshair', touchAction: 'none', zIndex: 50 }}
            >
              <svg aria-hidden="true" className="h-full w-full overflow-visible" data-testid="crop-straighten-overlay">
                {descriptor.straightenLine !== null && (
                  <line
                    data-overlay-geometry-epoch={descriptor.straightenLine.geometryEpoch}
                    data-testid="crop-straighten-guide"
                    stroke="var(--editor-accent)"
                    strokeDasharray="4 4"
                    strokeWidth="2"
                    x1={descriptor.straightenLine.start.x}
                    x2={descriptor.straightenLine.end.x}
                    y1={descriptor.straightenLine.start.y}
                    y2={descriptor.straightenLine.end.y}
                  />
                )}
              </svg>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
