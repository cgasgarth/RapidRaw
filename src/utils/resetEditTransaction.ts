import { z } from 'zod';
import { type EditDocumentV2, editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { EditTransactionRequest } from './editTransaction';

const resetAdjustmentsResultSchema = z
  .object({
    editDocumentV2: editDocumentV2Schema,
    path: z.string().min(1),
    renderGeneration: z.number().int().nonnegative(),
    revision: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  })
  .strict();

export const resetAdjustmentsResultsSchema = z.array(resetAdjustmentsResultSchema).min(1);
export type ResetAdjustmentsResult = z.infer<typeof resetAdjustmentsResultSchema>;

export const assertResetAdjustmentsResultCoverage = (
  results: readonly ResetAdjustmentsResult[],
  requestedPaths: readonly string[],
): void => {
  const requested = new Set(requestedPaths);
  const received = new Set(results.map(({ path }) => path));
  if (received.size !== results.length) throw new Error('reset_edit_transaction.duplicate_receipt');
  if (received.size !== requested.size || [...requested].some((path) => !received.has(path))) {
    throw new Error('reset_edit_transaction.receipt_coverage');
  }
};

export interface ResetEditCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface ResetEditTransactionState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { isReady: boolean; path: string } | null;
}

const currentImageSessionId = (state: ResetEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureResetEditCommitIdentity = (
  state: ResetEditTransactionState,
  targetPath: string,
): ResetEditCommitIdentity | null =>
  state.selectedImage?.isReady === true && state.selectedImage.path === targetPath
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        sourceIdentity: targetPath,
      }
    : null;

export const isCurrentResetEditCommitIdentity = (
  state: ResetEditTransactionState,
  identity: ResetEditCommitIdentity,
): boolean =>
  state.selectedImage?.path === identity.sourceIdentity &&
  currentImageSessionId(state) === identity.imageSessionId &&
  state.adjustmentRevision === identity.adjustmentRevision;

export const buildResetEditTransaction = (
  state: ResetEditTransactionState,
  identity: ResetEditCommitIdentity,
  result: ResetAdjustmentsResult,
  transactionId: string,
): EditTransactionRequest => {
  if (result.path !== identity.sourceIdentity) {
    throw new Error(`reset_edit_transaction.receipt_source:${identity.sourceIdentity}:${result.path}`);
  }
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `reset_edit_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`reset_edit_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `reset_edit_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'reset',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        editDocumentV2: result.editDocumentV2,
        type: 'replace-edit-document',
      },
    ],
    persistence: 'native-committed',
    source: 'reset',
    transactionId,
  };
};
