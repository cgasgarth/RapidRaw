export type ViewerPointerType = 'mouse' | 'pen' | 'touch';

interface ActiveViewerPointer {
  readonly pointerId: number;
  readonly pointerType: ViewerPointerType;
}

export interface ViewerPointerLifecycleSnapshot {
  readonly active: ActiveViewerPointer | null;
  readonly compatibilityMouseSuppressed: boolean;
}

export interface ViewerPointerLifecycle {
  begin(pointerType: ViewerPointerType, pointerId: number): boolean;
  cancel(): void;
  end(pointerType: ViewerPointerType, pointerId: number): boolean;
  move(pointerType: ViewerPointerType, pointerId: number): boolean;
  releaseCompatibilityMouse(): void;
  snapshot(): ViewerPointerLifecycleSnapshot;
}

/** Filters compatibility mouse events and competing pointers for one viewer gesture session. */
export const createViewerPointerLifecycle = (): ViewerPointerLifecycle => {
  let active: ActiveViewerPointer | null = null;
  let compatibilityMouseSuppressed = false;
  const matches = (pointerType: ViewerPointerType, pointerId: number) =>
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
