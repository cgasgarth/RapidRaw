import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_LAYER_BLEND_MODE, LAYER_BLEND_MODES, type LayerBlendMode } from '../../../../utils/adjustments';

export interface MaskLikeDragData {
  parentId?: string;
  type: 'Container' | 'Creation' | 'SubMask';
}

export const MASK_CONTAINER_RUNTIME_BLEND_MODES = [
  DEFAULT_LAYER_BLEND_MODE,
  'multiply',
  'screen',
] as const satisfies ReadonlyArray<LayerBlendMode>;

export type MaskContainerRuntimeBlendMode = (typeof MASK_CONTAINER_RUNTIME_BLEND_MODES)[number];

const runtimeBlendModeSet = new Set<LayerBlendMode>(MASK_CONTAINER_RUNTIME_BLEND_MODES);

export function isLayerBlendMode(value: string): value is LayerBlendMode {
  return LAYER_BLEND_MODES.some((blendMode) => blendMode === value);
}

export function isMaskContainerRuntimeBlendMode(value: string): value is MaskContainerRuntimeBlendMode {
  return isLayerBlendMode(value) && runtimeBlendModeSet.has(value);
}

export function getRuntimeMaskContainerBlendMode(value: LayerBlendMode | undefined): MaskContainerRuntimeBlendMode {
  return value && isMaskContainerRuntimeBlendMode(value) ? value : DEFAULT_LAYER_BLEND_MODE;
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
  if (activeDragItem?.type === 'Container') return 'border-t-2 border-editor-primary-active';
  if (
    (activeDragItem?.type === 'SubMask' && activeDragItem.parentId !== containerId) ||
    activeDragItem?.type === 'Creation'
  ) {
    return 'border border-editor-primary-active/50 bg-editor-selected-quiet';
  }
  return '';
}

export function getMaskLikeSubMaskDropClass(activeDragItem: MaskLikeDragData | null, isOver: boolean): string {
  return isOver && !isMaskLikeContainerDrag(activeDragItem) ? 'border-t-2 border-editor-primary-active' : '';
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
