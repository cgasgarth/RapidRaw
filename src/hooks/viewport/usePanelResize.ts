import { type PointerEvent as ReactPointerEvent, useCallback } from 'react';

export type ResizeTarget = 'bottom' | 'compact' | 'left' | 'right';

export type CreateResizeHandler = (
  target: ResizeTarget,
  startSize: number,
) => (event: ReactPointerEvent<HTMLDivElement>) => void;

export const PANEL_RESIZE_LIMITS = {
  bottom: { max: 400, min: 100 },
  left: { max: 500, min: 200 },
  right: { max: 600, min: 320 },
} as const;

interface UsePanelResizeOptions {
  compactEditorPanelMaxHeight: number;
  compactEditorPanelMinHeight: number;
  onBottomPanelHeightChange: (height: number) => void;
  onCompactEditorPanelHeightOverrideChange: (height: number) => void;
  onLeftPanelWidthChange: (width: number) => void;
  onResizingChange: (isResizing: boolean) => void;
  onRightPanelWidthChange: (width: number) => void;
}

const clampPanelSize = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(value, max)));

export function usePanelResize({
  compactEditorPanelMaxHeight,
  compactEditorPanelMinHeight,
  onBottomPanelHeightChange,
  onCompactEditorPanelHeightOverrideChange,
  onLeftPanelWidthChange,
  onResizingChange,
  onRightPanelWidthChange,
}: UsePanelResizeOptions): CreateResizeHandler {
  return useCallback(
    (target, startSize) => (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onResizingChange(true);

      const pointerId = event.pointerId;
      const pointerTarget = event.currentTarget;
      const startX = event.clientX;
      const startY = event.clientY;

      const previousCursor = document.documentElement.style.cursor;
      const previousTouchAction = document.documentElement.style.touchAction;
      const previousUserSelect = document.documentElement.style.userSelect;

      pointerTarget.setPointerCapture(pointerId);
      document.documentElement.style.cursor = target === 'bottom' || target === 'compact' ? 'row-resize' : 'col-resize';
      document.documentElement.style.touchAction = 'none';
      document.documentElement.style.userSelect = 'none';

      const doDrag = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        moveEvent.preventDefault();

        if (target === 'left') {
          onLeftPanelWidthChange(
            clampPanelSize(
              startSize + (moveEvent.clientX - startX),
              PANEL_RESIZE_LIMITS.left.min,
              PANEL_RESIZE_LIMITS.left.max,
            ),
          );
        } else if (target === 'right') {
          onRightPanelWidthChange(
            clampPanelSize(
              startSize - (moveEvent.clientX - startX),
              PANEL_RESIZE_LIMITS.right.min,
              PANEL_RESIZE_LIMITS.right.max,
            ),
          );
        } else if (target === 'bottom') {
          onBottomPanelHeightChange(
            clampPanelSize(
              startSize - (moveEvent.clientY - startY),
              PANEL_RESIZE_LIMITS.bottom.min,
              PANEL_RESIZE_LIMITS.bottom.max,
            ),
          );
        } else {
          onCompactEditorPanelHeightOverrideChange(
            clampPanelSize(
              startSize - (moveEvent.clientY - startY),
              compactEditorPanelMinHeight,
              compactEditorPanelMaxHeight,
            ),
          );
        }
      };

      const stopDrag = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        if (pointerTarget.hasPointerCapture(pointerId)) pointerTarget.releasePointerCapture(pointerId);

        document.documentElement.style.cursor = previousCursor;
        document.documentElement.style.touchAction = previousTouchAction;
        document.documentElement.style.userSelect = previousUserSelect;

        window.removeEventListener('pointermove', doDrag);
        window.removeEventListener('pointerup', stopDrag);
        window.removeEventListener('pointercancel', stopDrag);
        onResizingChange(false);
      };

      window.addEventListener('pointermove', doDrag, { passive: false });
      window.addEventListener('pointerup', stopDrag);
      window.addEventListener('pointercancel', stopDrag);
    },
    [
      compactEditorPanelMaxHeight,
      compactEditorPanelMinHeight,
      onBottomPanelHeightChange,
      onCompactEditorPanelHeightOverrideChange,
      onLeftPanelWidthChange,
      onResizingChange,
      onRightPanelWidthChange,
    ],
  );
}
