import type { MaskContainer } from '../adjustments';

export interface MaskSelection {
  containerId: string | null;
  subMaskId: string | null;
}

export interface MaskGraphCommandResult {
  masks: Array<MaskContainer>;
  openContainerId?: string;
  selection: MaskSelection;
  selectBrushTool?: boolean;
}

export const EMPTY_MASK_SELECTION: MaskSelection = { containerId: null, subMaskId: null };

/** Resolve both selection ids against the same mask graph snapshot. */
export function resolveMaskSelection(masks: ReadonlyArray<MaskContainer>, requested: MaskSelection): MaskSelection {
  if (requested.containerId === null) return EMPTY_MASK_SELECTION;
  const container = masks.find((candidate) => candidate.id === requested.containerId);
  if (container === undefined) return EMPTY_MASK_SELECTION;
  if (requested.subMaskId === null) return { containerId: container.id, subMaskId: null };
  return container.subMasks.some((subMask) => subMask.id === requested.subMaskId)
    ? { containerId: container.id, subMaskId: requested.subMaskId }
    : { containerId: container.id, subMaskId: null };
}

export function selectionAfterContainerDeletion(
  masks: ReadonlyArray<MaskContainer>,
  deletedContainerId: string,
  current: MaskSelection,
): MaskSelection {
  if (current.containerId !== deletedContainerId) return resolveMaskSelection(masks, current);
  const deletedIndex = masks.findIndex((container) => container.id === deletedContainerId);
  const remaining = masks.filter((container) => container.id !== deletedContainerId);
  const fallback = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)];
  return fallback === undefined ? EMPTY_MASK_SELECTION : { containerId: fallback.id, subMaskId: null };
}

export function selectionAfterSubMaskDeletion(
  masks: ReadonlyArray<MaskContainer>,
  containerId: string,
  deletedSubMaskId: string,
  current: MaskSelection,
): MaskSelection {
  if (current.containerId !== containerId || current.subMaskId !== deletedSubMaskId) {
    return resolveMaskSelection(masks, current);
  }
  const container = masks.find((candidate) => candidate.id === containerId);
  if (container === undefined) return EMPTY_MASK_SELECTION;
  const deletedIndex = container.subMasks.findIndex((subMask) => subMask.id === deletedSubMaskId);
  const remaining = container.subMasks.filter((subMask) => subMask.id !== deletedSubMaskId);
  const fallback = remaining[Math.min(Math.max(deletedIndex, 0), remaining.length - 1)];
  return { containerId, subMaskId: fallback?.id ?? null };
}

export function validateMaskGraphCommand(result: MaskGraphCommandResult): MaskGraphCommandResult {
  const selection = resolveMaskSelection(result.masks, result.selection);
  const { openContainerId, ...command } = result;
  return openContainerId !== undefined && result.masks.some((mask) => mask.id === openContainerId)
    ? { ...command, openContainerId, selection }
    : { ...command, selection };
}
