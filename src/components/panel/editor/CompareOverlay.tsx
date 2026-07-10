import type { KeyboardEvent, PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { RenderSize } from '../../../hooks/viewport/useImageRenderSize';
import {
  clampCompareDivider,
  type EditorCompareOrientation,
  resolveCompareDividerGeometry,
} from '../../../utils/editorCompare';
import { imageCanvasLayerZIndex } from './imageCanvasContracts';

interface CompareOverlayProps {
  canShowOriginalCompare: boolean;
  compareDividerPosition: number;
  compareLabelsVisible: boolean;
  compareOrientation: EditorCompareOrientation;
  compareOverlayDisabled: boolean;
  editedImageRect: RenderSize;
  isCompareModeActive: boolean;
  onDividerPositionChange: (position: number) => void;
  onDividerReset: () => void;
  originalImageRect: RenderSize;
  originalStatus: 'error' | 'loading' | 'ready';
  showSideBySideCompare: boolean;
  showSplitCompare: boolean;
}

const cssPx = (value: number): string => `${String(value)}px`;

export function CompareOverlay({
  canShowOriginalCompare,
  compareDividerPosition,
  compareLabelsVisible,
  compareOrientation,
  compareOverlayDisabled,
  editedImageRect,
  isCompareModeActive,
  onDividerPositionChange,
  onDividerReset,
  originalImageRect,
  originalStatus,
  showSideBySideCompare,
  showSplitCompare,
}: CompareOverlayProps) {
  const { t } = useTranslation();
  const divider = resolveCompareDividerGeometry({
    dividerPosition: compareDividerPosition,
    imageRect: editedImageRect,
    orientation: compareOrientation,
  });

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const imageBounds = event.currentTarget.parentElement?.querySelector('svg')?.getBoundingClientRect();
    if (!imageBounds) return;
    const position =
      compareOrientation === 'vertical'
        ? (event.clientX - imageBounds.left) / imageBounds.width
        : (event.clientY - imageBounds.top) / imageBounds.height;
    onDividerPositionChange(clampCompareDivider(position));
  };
  const handleDividerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const decrementKey = compareOrientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
    const incrementKey = compareOrientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
    if (event.key === 'Home') {
      event.preventDefault();
      onDividerPositionChange(0.05);
    } else if (event.key === 'End') {
      event.preventDefault();
      onDividerPositionChange(0.95);
    } else if (event.key === decrementKey || event.key === incrementKey) {
      event.preventDefault();
      const direction = event.key === incrementKey ? 1 : -1;
      onDividerPositionChange(compareDividerPosition + direction * (event.shiftKey ? 0.1 : 0.01));
    }
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
          aria-orientation={compareOrientation}
          aria-valuemax={95}
          aria-valuemin={5}
          aria-valuenow={Math.round(compareDividerPosition * 100)}
          className="absolute touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-focus-ring"
          data-canvas-pointer-owner="compare-divider"
          data-testid="editor-compare-split-divider"
          onDoubleClick={(event) => {
            event.stopPropagation();
            onDividerReset();
          }}
          onKeyDown={handleDividerKeyDown}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            updateFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
          }}
          role="slider"
          style={{
            background: 'rgba(255, 255, 255, 0.9)',
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.72)',
            cursor: compareOrientation === 'vertical' ? 'col-resize' : 'row-resize',
            height: cssPx(divider.height),
            left: cssPx(divider.left),
            opacity: canShowOriginalCompare ? 1 : 0.4,
            top: cssPx(divider.top),
            width: cssPx(divider.width),
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
          {label(t('editor.canvas.compare.before'), editedImageRect, 'left')}
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
          {compareLabelsVisible && label(t('editor.canvas.compare.before'), originalImageRect, 'left')}
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
