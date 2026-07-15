import type { ViewerParametricMaskTargetKey } from '../components/panel/editor/viewerParametricMaskTargetInteractionController';
import type { SubMaskParameters } from '../components/panel/right/layers/Masks';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import { buildLayerEditTransactionRequest } from './layers/layerEditTransaction';

export interface ParametricMaskTargetEditTransactionState {
  readonly adjustmentRevision: number;
  readonly adjustments: Adjustments;
  readonly geometryEpoch: number;
  readonly imageSessionId: number;
  readonly imageSession?: { id: string } | null;
  readonly selectedImage: { path: string } | null;
  readonly sourceRevision: string;
}

const expectedImageSessionId = (state: ParametricMaskTargetEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

const assertCurrent = (state: ParametricMaskTargetEditTransactionState, key: ViewerParametricMaskTargetKey): void => {
  if (!key.active) throw new Error('parametric_mask_target.inactive');
  if (key.imageSessionId !== expectedImageSessionId(state))
    throw new Error('parametric_mask_target.stale_image_session');
  if (key.sourceIdentity !== state.selectedImage?.path) throw new Error('parametric_mask_target.stale_source');
  if (key.sourceRevision !== state.sourceRevision) throw new Error('parametric_mask_target.stale_source_revision');
  if (key.geometryEpoch !== state.geometryEpoch) throw new Error('parametric_mask_target.stale_geometry');
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
      if (subMask.type !== key.tool) throw new Error('parametric_mask_target.stale_tool');
      matched = true;
      return { ...subMask, parameters: { ...parameters } };
    });
  const adjustments: Adjustments = {
    ...state.adjustments,
    aiPatches: state.adjustments.aiPatches.map((patch) => ({ ...patch, subMasks: updateSubMasks(patch.subMasks) })),
    masks: state.adjustments.masks.map((mask) => ({ ...mask, subMasks: updateSubMasks(mask.subMasks) })),
  };
  if (!matched) throw new Error('parametric_mask_target.missing_mask');
  return buildLayerEditTransactionRequest(state, adjustments, transactionId);
};
