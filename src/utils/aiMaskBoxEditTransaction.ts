import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerAiMaskBoxSessionKey } from '../components/panel/editor/viewerAiMaskBoxInteractionController';
import type { SubMaskParameters } from '../components/panel/right/layers/Masks';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';

export interface AiMaskBoxEditTransactionState {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
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

  const masks = selectEditDocumentMasks(state.editDocumentV2);
  const aiPatches = selectEditDocumentAiPatches(state.editDocumentV2);
  const family = key.containerFamily === 'masks' ? masks : aiPatches;
  const duplicateContainerCount = family.filter((container) => container.id === key.containerId).length;
  if (duplicateContainerCount !== 1)
    reject(duplicateContainerCount === 0 ? 'missing_container' : 'duplicate_container');
  const siblingFamily = key.containerFamily === 'masks' ? aiPatches : masks;
  if (siblingFamily.some((container) => container.id === key.containerId)) reject('cross_family_container_collision');

  let matchedSubMaskCount = 0;
  const updateSubMasks = (subMasks: readonly (typeof masks)[number]['subMasks'][number][]) =>
    subMasks.map((subMask) => {
      if (subMask.id !== key.maskId) return subMask;
      matchedSubMaskCount += 1;
      if (subMask.type !== key.tool) reject('stale_tool');
      return { ...subMask, parameters: { ...parameters } };
    });
  const updatedMasks = masks.map((container) => {
    if (container.id !== key.containerId) return container;
    return { ...container, subMasks: updateSubMasks(container.subMasks) };
  });
  const updatedAiPatches = aiPatches.map((container) => {
    if (container.id !== key.containerId) return container;
    return { ...container, subMasks: updateSubMasks(container.subMasks) };
  });
  if (matchedSubMaskCount !== 1) reject(matchedSubMaskCount === 0 ? 'missing_mask' : 'duplicate_mask_in_container');
  if (siblingFamily.some((container) => container.subMasks.some((subMask) => subMask.id === key.maskId)))
    reject('cross_family_mask_collision');
  return buildLayerEditTransactionRequest(
    state,
    {
      aiPatches: key.containerFamily === 'aiPatches' ? updatedAiPatches : aiPatches,
      masks: key.containerFamily === 'masks' ? updatedMasks : masks,
    },
    transactionId,
  );
};
