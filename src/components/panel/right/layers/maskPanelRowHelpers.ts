import { useCallback, useEffect, useRef, useState } from 'react';

export interface MaskLikeDragData {
  parentId?: string;
  type: 'Container' | 'Creation' | 'SubMask';
}

export function isMaskLikeContainerDrag(activeDragItem: MaskLikeDragData | null): boolean {
  return activeDragItem?.type === 'Container';
}

export function getMaskLikeContainerDropClass({
  activeDragItem,
  containerId,
  isOver,
}: {
  activeDragItem: MaskLikeDragData | null;
  containerId: string;
  isOver: boolean;
}): string {
  if (!isOver) return '';
  if (activeDragItem?.type === 'Container') return 'border-t-2 border-accent';
  if (
    (activeDragItem?.type === 'SubMask' && activeDragItem.parentId !== containerId) ||
    activeDragItem?.type === 'Creation'
  ) {
    return 'bg-card-active border border-accent/50';
  }
  return '';
}

export function getMaskLikeSubMaskDropClass(activeDragItem: MaskLikeDragData | null, isOver: boolean): string {
  return isOver && !isMaskLikeContainerDrag(activeDragItem) ? 'border-t-2 border-accent' : '';
}

export function useDelayedHover(delayMs = 1000) {
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverTimeout = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearHoverTimeout();
    setIsHovered(true);
  }, [clearHoverTimeout]);

  const handleMouseLeave = useCallback(() => {
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      hoverTimeoutRef.current = null;
    }, delayMs);
  }, [clearHoverTimeout, delayMs]);

  useEffect(() => clearHoverTimeout, [clearHoverTimeout]);

  return { handleMouseEnter, handleMouseLeave, isHovered };
}
