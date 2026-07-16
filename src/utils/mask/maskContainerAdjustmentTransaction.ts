import type { MaskContainer } from '../adjustments';

const valuesEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const applyMaskContainerAdjustmentCandidate = (
  masks: readonly MaskContainer[],
  containerId: string,
  nextContainerAdjustments: MaskContainer['adjustments'],
): readonly MaskContainer[] => {
  const currentContainer = masks.find((container) => container.id === containerId);
  if (currentContainer === undefined) return masks;

  const containerChanged = !valuesEqual(currentContainer.adjustments, nextContainerAdjustments);
  if (!containerChanged) return masks;

  return masks.map((container) =>
    container.id === containerId ? { ...container, adjustments: nextContainerAdjustments } : container,
  );
};
