import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { AdjustmentSnapshot } from './adjustmentSnapshots';
import type { BasicAdjustment } from './adjustments';
import {
  assertBasicToneCommitIdentity,
  type BasicToneCommitIdentity,
  type BasicToneEditTransactionState,
} from './basicToneEditTransaction';
import { selectEditDocumentNode } from './editDocumentSelectors';
import { type EditTransactionRequest, reduceEditTransaction } from './editTransaction';

export interface BasicToneSliderInteraction {
  baseEditDocumentV2: EditDocumentV2;
  identity: BasicToneCommitIdentity;
  interactionId: string;
  key: BasicAdjustment;
  latestValue: number;
  previewSnapshot: AdjustmentSnapshot | null;
}

export interface BasicToneSliderInteractionState extends BasicToneEditTransactionState {
  editDocumentV2: EditDocumentV2;
}

export const beginBasicToneSliderInteraction = (
  state: BasicToneSliderInteractionState,
  identity: BasicToneCommitIdentity,
  key: BasicAdjustment,
  interactionId: string,
): BasicToneSliderInteraction => {
  assertBasicToneCommitIdentity(state, identity);
  return {
    baseEditDocumentV2: structuredClone(state.editDocumentV2),
    identity,
    interactionId,
    key,
    latestValue: selectEditDocumentNode(state.editDocumentV2, 'scene_global_color_tone').params[key],
    previewSnapshot: null,
  };
};

export const isBasicToneSliderInteractionCurrent = (
  state: BasicToneEditTransactionState,
  interaction: BasicToneSliderInteraction,
): boolean => {
  try {
    assertBasicToneCommitIdentity(state, interaction.identity);
    return true;
  } catch {
    return false;
  }
};

export const buildBasicToneSliderInteractionRequest = (
  interaction: BasicToneSliderInteraction,
  value: number,
  phase: 'preview' | 'commit',
): EditTransactionRequest => ({
  baseAdjustmentRevision: interaction.identity.adjustmentRevision,
  history: phase === 'preview' ? 'none' : 'single-entry',
  imageSessionId: interaction.identity.imageSessionId,
  operations: [
    {
      nodeType: 'scene_global_color_tone',
      patch: { [interaction.key]: value },
      type: 'patch-edit-document-node',
    },
  ],
  persistence: phase === 'preview' ? 'preview-only' : 'commit',
  source: 'manual-control',
  transactionId: interaction.interactionId,
});

export const reduceBasicToneSliderInteractionPreview = (interaction: BasicToneSliderInteraction, value: number) =>
  reduceEditTransaction(
    interaction.baseEditDocumentV2,
    interaction.identity.adjustmentRevision,
    buildBasicToneSliderInteractionRequest(interaction, value, 'preview'),
    interaction.identity.imageSessionId,
  );

export const resolveBasicToneSliderRenderSnapshot = (
  committed: AdjustmentSnapshot,
  interaction: BasicToneSliderInteraction | null,
  state: BasicToneEditTransactionState,
): AdjustmentSnapshot =>
  interaction?.previewSnapshot !== null &&
  interaction?.previewSnapshot !== undefined &&
  isBasicToneSliderInteractionCurrent(state, interaction)
    ? interaction.previewSnapshot
    : committed;
