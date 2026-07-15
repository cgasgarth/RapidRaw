import type { KeyboardEvent, PointerEvent } from 'react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import type { EditorCompareOrientation } from '../../../utils/editorCompare';
import {
  type CompareDividerCommand,
  type CompareDividerCurrentContext,
  type CompareDividerPointerSample,
  createCompareDividerInteractionController,
  createCompareDividerOverlayDescriptor,
} from './compareDividerInteractionController';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

interface CompareOverlayProps {
  canShowOriginalCompare: boolean;
  compareDividerPosition: number;
  compareLabelsVisible: boolean;
  comparisonLabel?: string | null;
  compareOrientation: EditorCompareOrientation;
  compareOverlayDisabled: boolean;
  editedImageRect: RenderSize;
  geometryEpoch: number;
  imageSessionId: string;
  isCompareModeActive: boolean;
  onDividerPositionChange: (position: number) => void;
  onDividerReset: () => void;
  originalImageRect: RenderSize;
  originalStatus: 'error' | 'loading' | 'ready';
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
  sourceIdentity: string;
  sourceRevision: string;
}

const cssPx = (value: number): string => `${String(value)}px`;

export function CompareOverlay({
  canShowOriginalCompare,
  compareDividerPosition,
  compareLabelsVisible,
  comparisonLabel = null,
  compareOrientation,
  compareOverlayDisabled,
  editedImageRect,
  geometryEpoch,
  imageSessionId,
  isCompareModeActive,
  onDividerPositionChange,
  onDividerReset,
  originalImageRect,
  originalStatus,
  showSideBySideCompare,
  showSplitCompare,
  sourceIdentity,
  sourceRevision,
}: CompareOverlayProps) {
  const { t } = useTranslation();
  const controller = useMemo(() => createCompareDividerInteractionController(), []);
  const interactionContext: CompareDividerCurrentContext = {
    active: showSplitCompare,
    geometryEpoch,
    imageSessionId,
    imageRect: editedImageRect,
    orientation: compareOrientation,
    position: compareDividerPosition,
    sourceIdentity,
    sourceRevision,
  };
  const descriptor = createCompareDividerOverlayDescriptor(interactionContext);

  useEffect(() => {
    controller.invalidate();
  }, [controller, descriptor.sessionFingerprint]);

  useEffect(() => () => controller.invalidate(), [controller]);

  const execute = (commands: readonly CompareDividerCommand[]): void => {
    for (const command of commands) {
      if (command.kind === 'reset') onDividerReset();
      else onDividerPositionChange(command.position);
    }
  };

  const pointerSample = (event: PointerEvent<HTMLDivElement>): CompareDividerPointerSample | null => {
    const host = event.currentTarget.parentElement;
    if (!host || host.offsetWidth <= 0 || host.offsetHeight <= 0) return null;
    const hostBounds = host.getBoundingClientRect();
    const scaleX = hostBounds.width / host.offsetWidth;
    const scaleY = hostBounds.height / host.offsetHeight;
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      imageBounds: {
        height: editedImageRect.height * scaleY,
        left: hostBounds.left + editedImageRect.offsetX * scaleX,
        top: hostBounds.top + editedImageRect.offsetY * scaleY,
        width: editedImageRect.width * scaleX,
      },
      pointerId: event.pointerId,
      pointerType: event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse',
    };
  };

  const handleDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const commands = controller.dispatch(interactionContext, {
      key: event.key,
      shiftKey: event.shiftKey,
      type: 'keydown',
    });
    if (commands.length === 0) return;
    event.preventDefault();
    execute(commands);
  };

  const label = (text: string, rect: RenderSize, align: 'left' | 'right') => (
    <span
      className="pointer-events-none absolute rounded border border-editor-overlay-stroke bg-editor-panel/90 px-2 py-1 text-[11px] font-medium text-text-primary"
      style={{
        left: cssPx(align === 'left' ? rect.offsetX + 12 : rect.offsetX + rect.width - 12),
        top: cssPx(rect.offsetY + 12),
        transform: align === 'right' ? 'translateX(-100%)' : undefined,
        zIndex: imageCanvasLayerZIndex('viewerHud'),
      }}
    >
      {text}
    </span>
  );

  return (
    <>
      {showSplitCompare && (
        <div
          aria-label={t('editor.canvas.compare.splitWipeDivider')}
          aria-orientation={descriptor.accessibility.orientation}
          aria-valuemax={descriptor.accessibility.maximumPercent}
          aria-valuemin={descriptor.accessibility.minimumPercent}
          aria-valuenow={descriptor.accessibility.valuePercent}
          className="absolute touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          data-canvas-pointer-owner="compare-divider"
          data-compare-divider-geometry-epoch={String(descriptor.geometryEpoch)}
          data-compare-divider-session={descriptor.sessionFingerprint}
          data-testid="editor-compare-split-divider"
          onDoubleClick={(event) => {
            event.stopPropagation();
            execute(controller.dispatch(interactionContext, { type: 'reset' }));
          }}
          onKeyDown={handleDividerKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation();
            const sample = pointerSample(event);
            if (sample === null) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            execute(controller.dispatch(interactionContext, { ...sample, type: 'pointerdown' }));
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const sample = pointerSample(event);
            if (sample !== null) execute(controller.dispatch(interactionContext, { ...sample, type: 'pointermove' }));
          }}
          onPointerUp={(event) => {
            const sample = pointerSample(event);
            if (sample !== null) execute(controller.dispatch(interactionContext, { ...sample, type: 'pointerup' }));
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onPointerCancel={(event) => {
            const sample = pointerSample(event);
            if (sample !== null) controller.dispatch(interactionContext, { ...sample, type: 'pointercancel' });
          }}
          onLostPointerCapture={(event) => {
            const sample = pointerSample(event);
            if (sample !== null) controller.dispatch(interactionContext, { ...sample, type: 'lostpointercapture' });
          }}
          role="slider"
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.72)',
            cursor: compareOrientation === 'vertical' ? 'col-resize' : 'row-resize',
            height: cssPx(descriptor.geometry.height),
            left: cssPx(descriptor.geometry.left),
            opacity: canShowOriginalCompare ? 1 : 0.4,
            top: cssPx(descriptor.geometry.top),
            width: cssPx(descriptor.geometry.width),
            zIndex: imageCanvasLayerZIndex('viewerHud'),
          }}
          tabIndex={0}
        >
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-7 w-3 -translate-x-1/2 -translate-y-1/2 rounded border border-black/70 bg-white shadow"
          />
        </div>
      )}
      {compareLabelsVisible && showSplitCompare && (
        <>
          {label(comparisonLabel ?? t('editor.canvas.compare.before'), editedImageRect, 'left')}
          {label(t('editor.canvas.compare.after'), editedImageRect, 'right')}
        </>
      )}
      {showSideBySideCompare && (
        <div
          aria-label={t('editor.canvas.compare.sideBySideRegion')}
          className="pointer-events-none absolute inset-0"
          data-canvas-pointer-owner="pan-zoom"
          data-testid="editor-compare-side-by-side-preview"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {compareLabelsVisible &&
            label(comparisonLabel ?? t('editor.canvas.compare.before'), originalImageRect, 'left')}
          {compareLabelsVisible && label(t('editor.canvas.compare.after'), editedImageRect, 'left')}
        </div>
      )}
      {isCompareModeActive && !compareOverlayDisabled && !canShowOriginalCompare && (
        <div
          className="pointer-events-none absolute bottom-3 left-3 rounded-md border border-editor-warning/50 bg-editor-warning-surface px-3 py-2 text-xs font-medium text-editor-warning"
          data-testid="editor-compare-loading-reason"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {originalStatus === 'error'
            ? t('editor.canvas.compare.originalFailed')
            : t('editor.canvas.compare.loadingOriginal')}
        </div>
      )}
      {compareOverlayDisabled && (
        <div
          className="pointer-events-none absolute bottom-3 right-3 rounded-md border border-editor-warning/50 bg-editor-warning-surface px-3 py-2 text-xs font-medium text-editor-warning"
          data-testid="editor-compare-overlay-disabled-reason"
          style={{ zIndex: imageCanvasLayerZIndex('viewerHud') }}
        >
          {t('editor.canvas.compare.overlayDisabled')}
        </div>
      )}
    </>
  );
}
