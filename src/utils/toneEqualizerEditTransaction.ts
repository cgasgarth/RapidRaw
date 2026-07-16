import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import type { BasicToneCommitIdentity } from './basicToneEditTransaction';
import { selectEditDocumentNode } from './editDocumentSelectors';
import type { EditTransactionRequest } from './editTransaction';

export interface ToneEqualizerEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: ToneEqualizerEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const isCurrentToneEqualizerAsyncRequest = (
  state: ToneEqualizerEditTransactionState,
  identity: BasicToneCommitIdentity,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean =>
  requestGeneration === currentRequestGeneration &&
  state.selectedImage?.path === identity.sourceIdentity &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.adjustmentRevision === identity.adjustmentRevision;

export const buildToneEqualizerEditTransaction = (
  state: ToneEqualizerEditTransactionState,
  identity: BasicToneCommitIdentity,
  patch: Partial<Adjustments['toneEqualizer']>,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `tone_equalizer_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `tone_equalizer_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `tone_equalizer_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'tone_equalizer',
        patch: {
          toneEqualizer: {
            ...structuredClone(selectEditDocumentNode(state.editDocumentV2, 'tone_equalizer').params['toneEqualizer']),
            ...structuredClone(patch),
          },
        },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
