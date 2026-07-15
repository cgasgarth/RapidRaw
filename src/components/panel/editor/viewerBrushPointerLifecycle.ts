import type { ViewerBrushPointerType } from './viewerBrushInteractionController';

interface ActiveViewerBrushPointer {
  readonly pointerId: number;
  readonly pointerType: ViewerBrushPointerType;
}

export interface ViewerBrushPointerLifecycleSnapshot {
  readonly active: ActiveViewerBrushPointer | null;
  readonly compatibilityMouseSuppressed: boolean;
}

export interface ViewerBrushPointerLifecycle {
  begin(pointerType: ViewerBrushPointerType, pointerId: number): boolean;
  cancel(): void;
  end(pointerType: ViewerBrushPointerType, pointerId: number): boolean;
  move(pointerType: ViewerBrushPointerType, pointerId: number): boolean;
  releaseCompatibilityMouse(): void;
  snapshot(): ViewerBrushPointerLifecycleSnapshot;
}

/** Filters compatibility mouse events and competing pointers before they reach one brush session. */
export const createViewerBrushPointerLifecycle = (): ViewerBrushPointerLifecycle => {
  let active: ActiveViewerBrushPointer | null = null;
  let compatibilityMouseSuppressed = false;
  const matches = (pointerType: ViewerBrushPointerType, pointerId: number) =>
    active?.pointerId === pointerId && active.pointerType === pointerType;
  return {
    begin: (pointerType, pointerId) => {
      if ((pointerType === 'mouse' && compatibilityMouseSuppressed) || active !== null) return false;
      active = { pointerId, pointerType };
      if (pointerType !== 'mouse') compatibilityMouseSuppressed = true;
      return true;
    },
    cancel: () => {
      active = null;
      compatibilityMouseSuppressed = false;
    },
    end: (pointerType, pointerId) => {
      if (!matches(pointerType, pointerId)) return false;
      active = null;
      return true;
    },
    move: matches,
    releaseCompatibilityMouse: () => {
      if (active === null) compatibilityMouseSuppressed = false;
    },
    snapshot: () => ({ active, compatibilityMouseSuppressed }),
  };
};
