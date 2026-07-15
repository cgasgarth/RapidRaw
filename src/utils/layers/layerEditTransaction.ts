import type { Adjustments } from '../adjustments';
import type { EditTransactionRequest } from '../editTransaction';

export interface LayerEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

export const buildLayerEditTransactionRequest = (
  state: LayerEditTransactionState,
  nextAdjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => {
  const compatibilityPatch = Object.fromEntries(
    [...new Set([...Object.keys(state.adjustments), ...Object.keys(nextAdjustments)])]
      .filter((key) => key !== 'masks')
      .filter((key) => {
        const before = state.adjustments[key as keyof Adjustments];
        const after = nextAdjustments[key as keyof Adjustments];
        return !Object.is(before, after) && JSON.stringify(before) !== JSON.stringify(after);
      })
      .map((key) => [key, nextAdjustments[key as keyof Adjustments]]),
  ) as Partial<Adjustments>;
  const operations: EditTransactionRequest['operations'] = [
    ...(Object.keys(compatibilityPatch).length === 0
      ? []
      : [{ type: 'patch-adjustments' as const, patch: compatibilityPatch }]),
    {
      type: 'patch-edit-document-node' as const,
      nodeType: 'layers' as const,
      patch: { masks: structuredClone(nextAdjustments.masks) },
    },
  ];
  return {
    transactionId,
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    baseAdjustmentRevision: state.adjustmentRevision,
    source: 'layer-command',
    operations,
    history: 'single-entry',
    persistence: 'commit',
  };
};
