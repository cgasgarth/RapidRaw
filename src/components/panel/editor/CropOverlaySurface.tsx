import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import CropOverlay, { type Crop, type PercentCrop } from 'react-image-crop';
import type { EditorOverlayGeometry } from '../../../utils/editorOverlayGeometry';
import type { OverlayMode } from '../right/color/CropPanel';
import {
  type CropStraightenControllerTransition,
  type CropStraightenSessionIdentity,
  createCropStraightenController,
} from './cropStraightenController';
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
  onCropPreviewError: () => void;
  onCropPreviewLoad: () => void;
  onStraighten: (correctionDegrees: number, identity: CropStraightenSessionIdentity) => void;
  isMaxZoom: boolean | undefined;
  isRotationActive: boolean | undefined;
  isStraightenActive: boolean;
  overlayMode: OverlayMode | undefined;
  overlayRotation: number | undefined;
  rotationDegrees: number;
  session: CropStraightenSessionIdentity | null;
  setCrop: (crop: Crop, percentCrop: PercentCrop) => void;
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
  onCropPreviewError,
  onCropPreviewLoad,
  onStraighten,
  isMaxZoom,
  isRotationActive,
  isStraightenActive,
  overlayMode,
  overlayRotation,
  rotationDegrees,
  session,
  setCrop,
}: CropOverlaySurfaceProps) {
  const { t } = useTranslation();
  const controller = useMemo(() => createCropStraightenController(), []);
  const [controllerOverlay, setControllerOverlay] = useState<CropStraightenControllerTransition['overlay']>(null);
  const straightenInputRef = useRef<HTMLDivElement>(null);
  const intentionalPointerReleasesRef = useRef(new Set<number>());
  const handlersRef = useRef({ handleCropComplete, handleCropStart, onStraighten, setCrop });
  handlersRef.current = { handleCropComplete, handleCropStart, onStraighten, setCrop };
  const applyTransition = useCallback((transition: CropStraightenControllerTransition, publish = true) => {
    if (publish) setControllerOverlay(transition.overlay);
    for (const command of transition.commands) {
      if (command.type === 'capture-pointer') {
        straightenInputRef.current?.setPointerCapture(command.pointerId);
      } else if (command.type === 'release-pointer') {
        const target = straightenInputRef.current;
        if (target?.hasPointerCapture(command.pointerId)) {
          intentionalPointerReleasesRef.current.add(command.pointerId);
          target.releasePointerCapture(command.pointerId);
        }
      } else if (command.type === 'crop-started') {
        handlersRef.current.handleCropStart();
      } else if (command.type === 'crop-changed') {
        handlersRef.current.setCrop(command.crop, command.percentCrop);
      } else if (command.type === 'crop-completed') {
        handlersRef.current.handleCropComplete(command.crop, command.percentCrop);
      } else {
        handlersRef.current.onStraighten(command.correctionDegrees, command.identity);
      }
    }
  }, []);

  useLayoutEffect(() => {
    applyTransition(controller.dispatch({ session, type: 'session-installed' }));
  }, [applyTransition, controller, session]);
  useEffect(() => {
    const cancel = (reason: 'blur' | 'escape') => {
      const identity = controller.getState().session;
      applyTransition(controller.dispatch({ ...(identity === null ? {} : { identity }), reason, type: 'cancelled' }));
    };
    const onBlur = () => cancel('blur');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel('escape');
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [applyTransition, controller]);
  useEffect(
    () => () => {
      applyTransition(controller.dispatch({ reason: 'unmount', type: 'cancelled' }), false);
    },
    [applyTransition, controller],
  );

  const cropCanvasRatioLabel =
    aspectRatio === null ? t('editor.crop.presets.free.name') : `${aspectRatio.toFixed(2)}:1`;
  const cropCanvasOverlayLabel = isStraightenActive ? t('editor.crop.rotationHeading') : overlayMode || 'none';
  const cropWidth = cropRenderSize?.width;
  const cropHeight = cropRenderSize?.height;
  const dispatchCropStarted = () => {
    if (session !== null) applyTransition(controller.dispatch({ identity: session, type: 'crop-started' }));
  };
  const dispatchCropChanged = (nextCrop: Crop, percentCrop: PercentCrop) => {
    if (session !== null)
      applyTransition(controller.dispatch({ crop: nextCrop, identity: session, percentCrop, type: 'crop-changed' }));
  };
  const dispatchCropCompleted = (nextCrop: Crop, percentCrop: PercentCrop) => {
    if (session !== null)
      applyTransition(controller.dispatch({ crop: nextCrop, identity: session, percentCrop, type: 'crop-completed' }));
  };
  const pointerPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const dispatchStraightenPointer = (
    event: ReactPointerEvent<HTMLDivElement>,
    type: 'pointer-ended' | 'pointer-moved' | 'pointer-started',
  ) => {
    if (session === null || session.tool !== 'straighten') return;
    event.preventDefault();
    event.stopPropagation();
    applyTransition(
      type === 'pointer-started'
        ? controller.dispatch({
            identity: session,
            point: pointerPoint(event),
            pointerId: event.pointerId,
            renderSize: { height: cropHeight ?? 0, width: cropWidth ?? 0 },
            rotationDegrees,
            type,
          })
        : controller.dispatch({
            identity: session,
            point: pointerPoint(event),
            pointerId: event.pointerId,
            type,
          }),
    );
  };

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
      data-crop-view-visible={String(isCropViewVisible)}
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
        <div onPointerDown={dispatchCropStarted} style={{ height: cropHeight, position: 'relative', width: cropWidth }}>
          <CropOverlay
            aspect={aspectRatio}
            crop={crop}
            onChange={dispatchCropChanged}
            onComplete={dispatchCropCompleted}
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
              data-controller-geometry-epoch={session?.geometryEpoch}
              data-controller-image-session={session?.imageSessionId}
              data-controller-operation-generation={session?.operationGeneration}
              data-controller-source-identity={session?.sourceIdentity}
              data-controller-source-revision={session?.sourceRevision}
              data-testid="crop-straighten-input-surface"
              onLostPointerCapture={(event) => {
                if (intentionalPointerReleasesRef.current.delete(event.pointerId)) return;
                applyTransition(
                  controller.dispatch({
                    ...(session === null ? {} : { identity: session }),
                    pointerId: event.pointerId,
                    reason: 'lost-pointer-capture',
                    type: 'cancelled',
                  }),
                );
              }}
              onPointerCancel={(event) =>
                applyTransition(
                  controller.dispatch({
                    ...(session === null ? {} : { identity: session }),
                    pointerId: event.pointerId,
                    reason: 'pointer-cancel',
                    type: 'cancelled',
                  }),
                )
              }
              onPointerDown={(event) => {
                if (event.button === 0) dispatchStraightenPointer(event, 'pointer-started');
              }}
              onPointerMove={(event) => dispatchStraightenPointer(event, 'pointer-moved')}
              onPointerUp={(event) => dispatchStraightenPointer(event, 'pointer-ended')}
              ref={straightenInputRef}
              role="application"
              style={{ cursor: 'crosshair', touchAction: 'none', zIndex: 50 }}
            >
              <svg aria-hidden="true" className="h-full w-full overflow-visible" data-testid="crop-straighten-overlay">
                {controllerOverlay !== null && (
                  <line
                    data-overlay-geometry-epoch={controllerOverlay.geometryEpoch}
                    data-testid="crop-straighten-guide"
                    stroke="var(--editor-accent)"
                    strokeDasharray="4 4"
                    strokeWidth="2"
                    x1={controllerOverlay.start.x}
                    x2={controllerOverlay.end.x}
                    y1={controllerOverlay.start.y}
                    y2={controllerOverlay.end.y}
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
