import type { ViewerInitialMaskDrawSessionKey } from '../components/panel/editor/viewerInitialMaskDrawInteractionController';
import type { Mask, SubMask } from '../components/panel/right/layers/Masks';
import type { Adjustments, AiPatch, MaskContainer } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface InitialMaskDrawEditTransactionState {
  readonly adjustmentRevision: number;
  readonly adjustmentSnapshot: { readonly value: Adjustments };
  readonly geometryEpoch: number;
  readonly imageSession: { readonly id: string } | null;
  readonly selectedImage: { readonly path: string } | null;
  readonly sourceRevision: string;
}

const updateSubMask = <Container extends MaskContainer | AiPatch>(
  containers: readonly Container[],
  maskId: string,
  tool: ViewerInitialMaskDrawSessionKey['tool'],
  parameters: Readonly<Record<string, unknown>>,
): { readonly containers: Container[]; readonly found: boolean } => {
  let found = false;
  const containersAfter = containers.map((container) => ({
    ...container,
    subMasks: container.subMasks.map((subMask: SubMask) => {
      if (subMask.id !== maskId) return subMask;
      if ((subMask.type as Mask) !== tool)
        throw new Error(`initial_mask_transaction.tool_mismatch:${subMask.type}:${tool}`);
      found = true;
      return { ...subMask, parameters: { ...parameters } };
    }),
  })) as Container[];
  return { containers: containersAfter, found };
};

export const buildInitialMaskDrawEditTransaction = (
  state: InitialMaskDrawEditTransactionState,
  identity: ViewerInitialMaskDrawSessionKey,
  parameters: Readonly<Record<string, unknown>>,
  transactionId: string,
): EditTransactionRequest => {
  if (!identity.active || identity.operationGeneration < 1) {
    throw new Error(`initial_mask_transaction.invalid_generation:${String(identity.operationGeneration)}`);
  }
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `initial_mask_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `initial_mask_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.sourceRevision !== identity.sourceRevision) {
    throw new Error(`initial_mask_transaction.stale_graph:${identity.sourceRevision}:${state.sourceRevision}`);
  }
  if (state.geometryEpoch !== identity.geometryEpoch) {
    throw new Error(
      `initial_mask_transaction.stale_geometry:${String(identity.geometryEpoch)}:${String(state.geometryEpoch)}`,
    );
  }

  const masks = updateSubMask(state.adjustmentSnapshot.value.masks, identity.maskId, identity.tool, parameters);
  const aiPatches = updateSubMask(state.adjustmentSnapshot.value.aiPatches, identity.maskId, identity.tool, parameters);
  if (!masks.found && !aiPatches.found) throw new Error(`initial_mask_transaction.missing_mask:${identity.maskId}`);

  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'layers',
        patch: { masks: masks.containers },
        type: 'patch-edit-document-node',
      },
      {
        nodeType: 'source_artifacts',
        patch: { aiPatches: aiPatches.containers },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'layer-command',
    transactionId,
  };
};
