export const VIEWER_DRAG_THRESHOLD_PX = 5;

export type ViewerActiveTool =
  | 'brush'
  | 'crop'
  | 'focus-retouch'
  | 'mask'
  | 'none'
  | 'object-prompt'
  | 'point-color'
  | 'retouch'
  | 'tone-equalizer'
  | 'white-balance';
export type ViewerCursor =
  | 'crosshair'
  | 'default'
  | 'grab'
  | 'grabbing'
  | 'not-allowed'
  | 'progress'
  | 'zoom-in'
  | 'zoom-out';
export type ViewerFocusContext = 'editable' | 'modal' | 'viewer';
export type ViewerGestureOwner = 'active-tool' | 'blocked' | 'viewer-pan';
export type ViewerPointerType = 'mouse' | 'pen' | 'touch';
export type ViewerWheelIntent = 'pan' | 'zoom';

export interface ViewerInputResolution {
  cursor: ViewerCursor;
  owner: ViewerGestureOwner;
  reason: 'active-tool' | 'middle-button' | 'modal-blocked' | 'primary-viewer' | 'temporary-hand' | 'two-finger-pan';
  shouldCapturePointer: boolean;
}

export interface ResolveViewerInputInput {
  activeTool: ViewerActiveTool;
  button: number;
  focusContext: ViewerFocusContext;
  isDragging: boolean;
  isTemporaryHand: boolean;
  pointerCount: number;
  pointerType: ViewerPointerType;
  zoomed: boolean;
}

export const isViewerDrag = (start: { x: number; y: number }, current: { x: number; y: number }): boolean =>
  Math.hypot(current.x - start.x, current.y - start.y) > VIEWER_DRAG_THRESHOLD_PX;

const cursorForTool = (activeTool: ViewerActiveTool): ViewerCursor => {
  if (activeTool === 'point-color' || activeTool === 'tone-equalizer' || activeTool === 'white-balance')
    return 'crosshair';
  if (activeTool === 'brush' || activeTool === 'crop' || activeTool === 'mask' || activeTool === 'object-prompt') {
    return 'crosshair';
  }
  if (activeTool === 'focus-retouch' || activeTool === 'retouch') return 'crosshair';
  return 'default';
};

export const resolveViewerInput = ({
  activeTool,
  button,
  focusContext,
  isDragging,
  isTemporaryHand,
  pointerCount,
  pointerType,
  zoomed,
}: ResolveViewerInputInput): ViewerInputResolution => {
  if (focusContext === 'modal') {
    return { cursor: 'progress', owner: 'blocked', reason: 'modal-blocked', shouldCapturePointer: false };
  }

  if (pointerType === 'touch' && pointerCount >= 2) {
    return {
      cursor: isDragging ? 'grabbing' : 'grab',
      owner: 'viewer-pan',
      reason: 'two-finger-pan',
      shouldCapturePointer: true,
    };
  }

  if (pointerType === 'mouse' && button === 1) {
    return {
      cursor: isDragging ? 'grabbing' : 'grab',
      owner: 'viewer-pan',
      reason: 'middle-button',
      shouldCapturePointer: true,
    };
  }

  if (isTemporaryHand && focusContext !== 'editable') {
    return {
      cursor: isDragging ? 'grabbing' : 'grab',
      owner: 'viewer-pan',
      reason: 'temporary-hand',
      shouldCapturePointer: true,
    };
  }

  if (activeTool !== 'none') {
    return {
      cursor: cursorForTool(activeTool),
      owner: 'active-tool',
      reason: 'active-tool',
      shouldCapturePointer:
        activeTool === 'focus-retouch' || activeTool === 'point-color' || activeTool === 'tone-equalizer',
    };
  }

  return {
    cursor: isDragging ? 'grabbing' : zoomed ? 'zoom-out' : 'zoom-in',
    owner: 'viewer-pan',
    reason: 'primary-viewer',
    shouldCapturePointer: true,
  };
};

export const resolveViewerWheelIntent = ({
  ctrlKey,
  inputMode,
}: {
  ctrlKey: boolean;
  inputMode: 'mouse' | 'trackpad';
}): ViewerWheelIntent => (ctrlKey || inputMode === 'mouse' ? 'zoom' : 'pan');

export const shouldActivateTemporaryHand = ({
  focusContext,
  key,
}: {
  focusContext: ViewerFocusContext;
  key: string;
}): boolean => key === ' ' && focusContext === 'viewer';

export const shouldAllowViewerImageNavigation = ({
  controlOwnsKey,
  isViewerGestureDragging,
}: {
  controlOwnsKey: boolean;
  isViewerGestureDragging: boolean;
}): boolean => !controlOwnsKey && !isViewerGestureDragging;
