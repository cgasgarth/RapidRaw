import type { EditDocumentV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from '../adjustments';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from '../editTransaction';

export interface LayerEditTransactionState {
  adjustmentRevision: number;
  adjustmentSnapshot: { readonly value: Adjustments };
  editDocumentV2: EditDocumentV2;
  imageSessionId: number;
  imageSession?: { id: string } | null;
}

export const buildLayerEditTransactionRequest = (
  state: LayerEditTransactionState,
  nextAdjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => {
  const compatibilityChanged = [
    ...new Set([...Object.keys(state.adjustmentSnapshot.value), ...Object.keys(nextAdjustments)]),
  ]
    .filter((key) => key !== 'masks')
    .some((key) => {
      const before = state.adjustmentSnapshot.value[key as keyof Adjustments];
      const after = nextAdjustments[key as keyof Adjustments];
      return !Object.is(before, after) && JSON.stringify(before) !== JSON.stringify(after);
    });
  const operations: EditTransactionRequest['operations'] = compatibilityChanged
    ? buildAdjustmentMutationOperations(state.adjustmentSnapshot.value, nextAdjustments, state.editDocumentV2)
    : [
        {
          nodeType: 'layers',
          patch: { masks: structuredClone(nextAdjustments.masks) },
          type: 'patch-edit-document-node',
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
