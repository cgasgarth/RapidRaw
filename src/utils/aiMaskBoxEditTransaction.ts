import type { ViewerAiMaskBoxSessionKey } from '../components/panel/editor/viewerAiMaskBoxInteractionController';
import type { SubMaskParameters } from '../components/panel/right/layers/Masks';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';

export interface AiMaskBoxEditTransactionState {
  readonly adjustmentRevision: number;
  readonly adjustments: Adjustments;
  readonly geometryEpoch: number;
  readonly imageSessionId: number;
  readonly imageSession?: { readonly id: string } | null;
  readonly selectedImage: { readonly path: string } | null;
  readonly sourceRevision: string;
}

const reject = (reason: string): never => {
  throw new Error(`ai_mask_box_transaction.${reason}`);
};

const currentSessionId = (state: AiMaskBoxEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const buildAiMaskBoxEditTransaction = (
  state: AiMaskBoxEditTransactionState,
  key: ViewerAiMaskBoxSessionKey,
  parameters: Readonly<SubMaskParameters>,
  transactionId: string,
): EditTransactionRequest => {
  if (!key.active || key.operationGeneration < 1) reject('invalid_generation');
  if (key.imageSessionId !== currentSessionId(state)) reject('stale_session');
  if (key.sourceIdentity !== state.selectedImage?.path) reject('stale_source');
  if (key.sourceRevision !== state.sourceRevision) reject('stale_graph');
  if (key.geometryEpoch !== state.geometryEpoch) reject('stale_geometry');

  const family = state.adjustments[key.containerFamily];
  const duplicateContainerCount = family.filter((container) => container.id === key.containerId).length;
  if (duplicateContainerCount !== 1)
    reject(duplicateContainerCount === 0 ? 'missing_container' : 'duplicate_container');
  const siblingFamily = key.containerFamily === 'masks' ? state.adjustments.aiPatches : state.adjustments.masks;
  if (siblingFamily.some((container) => container.id === key.containerId)) reject('cross_family_container_collision');

  let matchedSubMaskCount = 0;
  const updatedFamily = family.map((container) => {
    if (container.id !== key.containerId) return container;
    return {
      ...container,
      subMasks: container.subMasks.map((subMask) => {
        if (subMask.id !== key.maskId) return subMask;
        matchedSubMaskCount += 1;
        if (subMask.type !== key.tool) reject('stale_tool');
        return { ...subMask, parameters: { ...parameters } };
      }),
    };
  });
  if (matchedSubMaskCount !== 1) reject(matchedSubMaskCount === 0 ? 'missing_mask' : 'duplicate_mask_in_container');
  if (siblingFamily.some((container) => container.subMasks.some((subMask) => subMask.id === key.maskId)))
    reject('cross_family_mask_collision');
  const adjustments: Adjustments = { ...state.adjustments, [key.containerFamily]: updatedFamily };
  return buildLayerEditTransactionRequest(state, adjustments, transactionId);
};
