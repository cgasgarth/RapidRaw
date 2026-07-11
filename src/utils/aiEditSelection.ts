import type { AiPatch } from './adjustments';

export interface AiEditSelection {
  containerId: string | null;
  subMaskId: string | null;
}

export interface AiEditCommandResult {
  aiPatches: Array<AiPatch>;
  selection: AiEditSelection;
  selectBrushTool?: boolean;
}

export interface AiEditCommandContext {
  aiPatches: Array<AiPatch>;
  selection: AiEditSelection;
}

export type AiEditCommand = (context: AiEditCommandContext) => AiEditCommandResult | null;

export const resolveAiEditSelection = (
  aiPatches: ReadonlyArray<AiPatch>,
  requested: AiEditSelection,
): AiEditSelection => {
  if (requested.containerId === null) return { containerId: null, subMaskId: null };

  const container = aiPatches.find((patch) => patch.id === requested.containerId);
  if (!container) return { containerId: null, subMaskId: null };

  const subMaskId =
    requested.subMaskId !== null && container.subMasks.some((subMask) => subMask.id === requested.subMaskId)
      ? requested.subMaskId
      : null;
  return { containerId: container.id, subMaskId };
};

export const selectionAfterSubMaskDeletion = (
  aiPatches: ReadonlyArray<AiPatch>,
  selection: AiEditSelection,
  containerId: string,
  subMaskId: string,
): AiEditSelection => {
  if (selection.containerId !== containerId || selection.subMaskId !== subMaskId) return selection;

  const container = aiPatches.find((patch) => patch.id === containerId);
  if (!container) return { containerId: null, subMaskId: null };
  const removedIndex = container.subMasks.findIndex((subMask) => subMask.id === subMaskId);
  if (removedIndex < 0) return selection;

  const survivors = container.subMasks.filter((subMask) => subMask.id !== subMaskId);
  return {
    containerId,
    subMaskId: survivors[Math.min(removedIndex, survivors.length - 1)]?.id ?? null,
  };
};

export const selectionAfterPatchDeletion = (
  aiPatches: ReadonlyArray<AiPatch>,
  selection: AiEditSelection,
  patchId: string,
): AiEditSelection => {
  if (selection.containerId !== patchId) return selection;

  const removedIndex = aiPatches.findIndex((patch) => patch.id === patchId);
  if (removedIndex < 0) return selection;
  const survivors = aiPatches.filter((patch) => patch.id !== patchId);
  return {
    containerId: survivors[Math.min(removedIndex, survivors.length - 1)]?.id ?? null,
    subMaskId: null,
  };
};
