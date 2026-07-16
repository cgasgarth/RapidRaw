import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { BasicAdjustment } from './adjustments';
import type { BasicToneCommandEnvelope } from './basicToneCommandBridge';
import type { EditTransactionRequest } from './editTransaction';

export interface BasicToneCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface BasicToneEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface BasicToneCommandEditTransactionState extends BasicToneEditTransactionState {
  editDocumentV2: EditDocumentV2;
}

const currentImageSessionId = (state: BasicToneEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureBasicToneCommitIdentity = (state: BasicToneEditTransactionState): BasicToneCommitIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: state.selectedImage.path,
      };

export const assertBasicToneCommitIdentity = (
  state: BasicToneEditTransactionState,
  identity: BasicToneCommitIdentity,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `basic_tone_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`basic_tone_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `basic_tone_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
};

export const buildBasicToneEditTransaction = (
  state: BasicToneEditTransactionState,
  identity: BasicToneCommitIdentity,
  key: BasicAdjustment,
  value: number,
  transactionId: string,
): EditTransactionRequest => {
  assertBasicToneCommitIdentity(state, identity);

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'scene_global_color_tone', patch: { [key]: value }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};

export const buildBasicToneCommandEditTransaction = (
  state: BasicToneCommandEditTransactionState,
  identity: BasicToneCommitIdentity,
  command: BasicToneCommandEnvelope,
): EditTransactionRequest => {
  assertBasicToneCommitIdentity(state, identity);
  const commandSource = command.target['imagePath'];
  if (typeof commandSource !== 'string' || commandSource !== identity.sourceIdentity) {
    throw new Error(
      `basic_tone_transaction.stale_command_source:${typeof commandSource === 'string' ? commandSource : 'none'}:${identity.sourceIdentity}`,
    );
  }
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'scene_global_color_tone',
        patch: {
          blacks: command.parameters.blackPoint,
          contrast: command.parameters.contrast,
          exposure: command.parameters.exposureEv,
          highlights: command.parameters.highlights,
          shadows: command.parameters.shadows,
          whites: command.parameters.whitePoint,
        },
        type: 'patch-edit-document-node',
      },
      {
        nodeType: 'detail_denoise_dehaze',
        patch: { clarity: command.parameters.clarity },
        type: 'patch-edit-document-node',
      },
      {
        nodeType: 'color_presence',
        patch: { saturation: command.parameters.saturation },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'agent-command',
    transactionId: command.commandId,
  };
};
