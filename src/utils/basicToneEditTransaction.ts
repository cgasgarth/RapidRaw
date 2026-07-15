import type { Adjustments, BasicAdjustment } from './adjustments';
import { applyBasicToneCommandEnvelopeToAdjustments, type BasicToneCommandEnvelope } from './basicToneCommandBridge';
import { buildAdjustmentMutationOperations, type EditTransactionRequest } from './editTransaction';

export interface BasicToneCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface BasicToneEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  selectedImage: { path: string } | null;
}

export interface BasicToneCommandEditTransactionState extends BasicToneEditTransactionState {
  adjustments: Adjustments;
}

export const captureBasicToneCommitIdentity = (state: BasicToneEditTransactionState): BasicToneCommitIdentity | null =>
  state.selectedImage === null || state.imageSession === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: state.selectedImage.path,
      };

const assertBasicToneCommitIdentity = (
  state: BasicToneEditTransactionState,
  identity: BasicToneCommitIdentity,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `basic_tone_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `basic_tone_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
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
  const adjustments = applyBasicToneCommandEnvelopeToAdjustments(state.adjustments, command);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: buildAdjustmentMutationOperations(state.adjustments, adjustments),
    persistence: 'commit',
    source: 'agent-command',
    transactionId: command.commandId,
  };
};
