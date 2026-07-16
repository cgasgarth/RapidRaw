import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerObjectPromptKey } from '../components/panel/editor/viewerObjectPromptInteractionController';
import type { SubMaskParameters } from '../components/panel/right/layers/Masks';
import type { MaskContainer } from './adjustments';
import { selectEditDocumentAiPatches, selectEditDocumentMasks } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';
import { readObjectPromptCanvasState } from './mask/objectMaskPromptCanvas';

export interface ObjectPromptEditTransactionState {
  readonly adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  readonly geometryEpoch: number;
  readonly imageSessionId: number;
  readonly imageSession: { readonly id: string } | null;
  readonly selectedImage: { readonly path: string } | null;
  readonly sourceRevision: string;
}

const reject = (reason: string): never => {
  throw new Error(`object_prompt_transaction.${reason}`);
};

export const buildObjectPromptEditTransaction = (
  state: ObjectPromptEditTransactionState,
  key: ViewerObjectPromptKey,
  parameters: Readonly<SubMaskParameters>,
  transactionId: string,
): EditTransactionRequest => {
  if (!key.active || key.operationGeneration < 1) reject('invalid_generation');
  if (state.imageSession?.id !== key.imageSessionId) reject('stale_image_session');
  if (state.selectedImage?.path !== key.sourceIdentity) reject('stale_source');
  if (state.sourceRevision !== key.sourceRevision) reject('stale_source_revision');
  if (state.geometryEpoch !== key.geometryEpoch) reject('stale_geometry');

  let matched = false;
  const update = (subMasks: MaskContainer['subMasks']) =>
    subMasks.map((subMask) => {
      if (subMask.id !== key.maskId) return subMask;
      if (subMask.type !== 'ai-object' || key.tool !== 'object-prompt') reject('stale_tool');
      if (readObjectPromptCanvasState(subMask.parameters).mode !== key.mode) reject('stale_mode');
      matched = true;
      return { ...subMask, parameters: { ...parameters } };
    });
  const aiPatches = selectEditDocumentAiPatches(state.editDocumentV2).map((patch) => ({
    ...patch,
    subMasks: update(patch.subMasks),
  }));
  const masks = selectEditDocumentMasks(state.editDocumentV2).map((mask) => ({
    ...mask,
    subMasks: update(mask.subMasks),
  }));
  if (!matched) reject('missing_mask');
  return buildLayerEditTransactionRequest(state, { aiPatches, masks }, transactionId);
};
