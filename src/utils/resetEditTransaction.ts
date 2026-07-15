import { z } from 'zod';

import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

const resetAdjustmentDocumentSchema = z.custom<Partial<Adjustments>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Reset adjustments must be an object',
);

export const resetAdjustmentsResultSchema = z
  .object({
    adjustments: resetAdjustmentDocumentSchema,
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
  imageSession: { id: string } | null;
  selectedImage: { isReady: boolean; path: string } | null;
}

export const captureResetEditCommitIdentity = (
  state: ResetEditTransactionState,
  targetPath: string,
): ResetEditCommitIdentity | null =>
  state.selectedImage?.isReady === true && state.selectedImage.path === targetPath && state.imageSession !== null
    ? {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: state.imageSession.id,
        sourceIdentity: targetPath,
      }
    : null;

export const isCurrentResetEditCommitIdentity = (
  state: ResetEditTransactionState,
  identity: ResetEditCommitIdentity,
): boolean =>
  state.selectedImage?.path === identity.sourceIdentity &&
  state.imageSession?.id === identity.imageSessionId &&
  state.adjustmentRevision === identity.adjustmentRevision;

export const buildResetEditTransaction = (
  state: ResetEditTransactionState,
  identity: ResetEditCommitIdentity,
  result: ResetAdjustmentsResult,
  dimensions: { height: number; width: number },
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
  if (state.imageSession?.id !== identity.imageSessionId) {
    throw new Error(
      `reset_edit_transaction.stale_session:${identity.imageSessionId}:${state.imageSession?.id ?? 'none'}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `reset_edit_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  const normalized = normalizeLoadedAdjustments(result.adjustments);
  const aspectRatio = dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : null;
  const resetAdjustments: Adjustments = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    ...normalized,
    aiPatches: [],
    aspectRatio,
  };
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'reset',
    imageSessionId: identity.imageSessionId,
    operations: [{ adjustments: resetAdjustments, type: 'replace-adjustments' }],
    persistence: 'native-committed',
    source: 'reset',
    transactionId,
  };
};
