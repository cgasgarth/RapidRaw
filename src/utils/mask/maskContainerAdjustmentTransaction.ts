import type { Adjustments, MaskContainer } from '../adjustments';

const valuesEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export const applyMaskContainerAdjustmentCandidate = (
  adjustments: Adjustments,
  containerId: string,
  nextContainerAdjustments: MaskContainer['adjustments'],
): Adjustments => {
  const currentContainer = adjustments.masks.find((container) => container.id === containerId);
  if (currentContainer === undefined) return adjustments;

  const containerChanged = !valuesEqual(currentContainer.adjustments, nextContainerAdjustments);
  const toneEqualizerChanged = !valuesEqual(
    currentContainer.adjustments.toneEqualizer,
    nextContainerAdjustments.toneEqualizer,
  );
  const requiresGraphPromotion = toneEqualizerChanged && adjustments.rawEngineEditGraphVersion < 2;
  if (!containerChanged && !requiresGraphPromotion) return adjustments;

  return {
    ...adjustments,
    ...(requiresGraphPromotion ? { rawEngineEditGraphVersion: 2 as const } : {}),
    masks: adjustments.masks.map((container) =>
      container.id === containerId ? { ...container, adjustments: nextContainerAdjustments } : container,
    ),
  };
};
