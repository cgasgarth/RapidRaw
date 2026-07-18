import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { AdjustmentSnapshot } from './adjustmentSnapshots';
import type { Adjustments } from './adjustments';
import { perceptualGradingFromWheelSurface } from './color/perceptualGrading';
import { selectEditDocumentNode } from './editDocumentSelectors';
import { type EditTransactionRequest, reduceEditTransaction } from './editTransaction';
import {
  isCurrentPerceptualGradingIdentity,
  type PerceptualGradingCommitIdentity,
  type PerceptualGradingEditTransactionState,
} from './perceptualGradingEditTransaction';

export interface PerceptualGradingSliderInteraction {
  baseEditDocumentV2: EditDocumentV2;
  identity: PerceptualGradingCommitIdentity;
  interactionId: string;
  latestColorGrading: Adjustments['colorGrading'];
  previewSnapshot: AdjustmentSnapshot | null;
}

export interface PerceptualGradingSliderInteractionState extends PerceptualGradingEditTransactionState {
  editDocumentV2: EditDocumentV2;
}

export const beginPerceptualGradingSliderInteraction = (
  state: PerceptualGradingSliderInteractionState,
  identity: PerceptualGradingCommitIdentity,
  interactionId: string,
): PerceptualGradingSliderInteraction => {
  if (!isCurrentPerceptualGradingIdentity(state, identity)) {
    throw new Error('perceptual_grading_transaction.stale_identity');
  }

  return {
    baseEditDocumentV2: structuredClone(state.editDocumentV2),
    identity,
    interactionId,
    latestColorGrading: structuredClone(
      selectEditDocumentNode(state.editDocumentV2, 'perceptual_grading').params.colorGrading,
    ),
    previewSnapshot: null,
  };
};

export const isCurrentPerceptualGradingSliderInteraction = (
  state: PerceptualGradingEditTransactionState,
  interaction: PerceptualGradingSliderInteraction,
): boolean => isCurrentPerceptualGradingIdentity(state, interaction.identity);

export const buildPerceptualGradingSliderInteractionRequest = (
  interaction: PerceptualGradingSliderInteraction,
  colorGrading: Adjustments['colorGrading'],
  phase: 'preview' | 'commit',
): EditTransactionRequest => ({
  baseAdjustmentRevision: interaction.identity.adjustmentRevision,
  history: phase === 'preview' ? 'none' : 'single-entry',
  imageSessionId: interaction.identity.imageSessionId,
  operations: [
    {
      nodeType: 'perceptual_grading',
      patch: {
        colorGrading: structuredClone(colorGrading),
        perceptualGradingV1: structuredClone(perceptualGradingFromWheelSurface(colorGrading)),
      },
      type: 'patch-edit-document-node',
    },
  ],
  persistence: phase === 'preview' ? 'preview-only' : 'commit',
  source: 'manual-control',
  transactionId: interaction.interactionId,
});

export const reducePerceptualGradingSliderInteractionPreview = (
  interaction: PerceptualGradingSliderInteraction,
  colorGrading: Adjustments['colorGrading'],
) =>
  reduceEditTransaction(
    interaction.baseEditDocumentV2,
    interaction.identity.adjustmentRevision,
    buildPerceptualGradingSliderInteractionRequest(interaction, colorGrading, 'preview'),
    interaction.identity.imageSessionId,
  );

export const resolvePerceptualGradingSliderRenderSnapshot = (
  committed: AdjustmentSnapshot,
  interaction: PerceptualGradingSliderInteraction | null,
  state: PerceptualGradingEditTransactionState,
): AdjustmentSnapshot =>
  interaction?.previewSnapshot !== null &&
  interaction?.previewSnapshot !== undefined &&
  isCurrentPerceptualGradingSliderInteraction(state, interaction)
    ? interaction.previewSnapshot
    : committed;
