import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { ViewerParametricMaskTargetKey } from '../components/panel/editor/viewerParametricMaskTargetInteractionController';
import type { SubMaskParameters } from '../components/panel/right/layers/Masks';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';

export interface ParametricMaskTargetEditTransactionState {
  readonly adjustmentRevision: number;
  readonly adjustmentSnapshot: { readonly value: Adjustments };
  readonly editDocumentV2: EditDocumentV2;
  readonly geometryEpoch: number;
  readonly imageSessionId: number;
  readonly imageSession?: { id: string } | null;
  readonly selectedImage: { path: string } | null;
  readonly sourceRevision: string;
}

const expectedImageSessionId = (state: ParametricMaskTargetEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

const rejectParametricMaskTarget = (reason: string): never => {
  throw new Error(`parametric_mask_target.${reason}`);
};

const assertCurrent = (state: ParametricMaskTargetEditTransactionState, key: ViewerParametricMaskTargetKey): void => {
  if (!key.active) rejectParametricMaskTarget('inactive');
  if (key.imageSessionId !== expectedImageSessionId(state)) rejectParametricMaskTarget('stale_image_session');
  if (key.sourceIdentity !== state.selectedImage?.path) rejectParametricMaskTarget('stale_source');
  if (key.sourceRevision !== state.sourceRevision) rejectParametricMaskTarget('stale_source_revision');
  if (key.geometryEpoch !== state.geometryEpoch) rejectParametricMaskTarget('stale_geometry');
};

export const buildParametricMaskTargetEditTransaction = (
  state: ParametricMaskTargetEditTransactionState,
  key: ViewerParametricMaskTargetKey,
  parameters: Readonly<SubMaskParameters>,
  transactionId: string,
): EditTransactionRequest => {
  assertCurrent(state, key);
  let matched = false;
  const updateSubMasks = (subMasks: Adjustments['masks'][number]['subMasks']) =>
    subMasks.map((subMask) => {
      if (subMask.id !== key.maskId) return subMask;
      if (subMask.type !== key.tool) rejectParametricMaskTarget('stale_tool');
      matched = true;
      return { ...subMask, parameters: { ...parameters } };
    });
  const adjustments: Adjustments = {
    ...state.adjustmentSnapshot.value,
    aiPatches: state.adjustmentSnapshot.value.aiPatches.map((patch) => ({
      ...patch,
      subMasks: updateSubMasks(patch.subMasks),
    })),
    masks: state.adjustmentSnapshot.value.masks.map((mask) => ({ ...mask, subMasks: updateSubMasks(mask.subMasks) })),
  };
  if (!matched) rejectParametricMaskTarget('missing_mask');
  return buildLayerEditTransactionRequest(state, adjustments, transactionId);
};
