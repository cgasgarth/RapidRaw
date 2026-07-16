import { z } from 'zod';

import { type Adjustments, INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from './adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from './editDocumentV2';
import type { EditTransactionRequest } from './editTransaction';

const resetAdjustmentDocumentSchema = z.custom<Partial<Adjustments>>(
  (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Reset adjustments must be an object',
);

const resetAdjustmentsResultSchema = z
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
  adjustmentSnapshot: { readonly value: Adjustments };
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
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(`reset_edit_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `reset_edit_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }

  const normalized = normalizeLoadedAdjustments(result.adjustments);
  const resultVisibility = result.adjustments['sectionVisibility'];
  const legacyEffectsEnabled =
    resultVisibility !== null && typeof resultVisibility === 'object' && !Array.isArray(resultVisibility)
      ? (resultVisibility as Readonly<Record<string, unknown>>)['effects']
      : undefined;
  if (!Object.hasOwn(result.adjustments, 'effectsEnabled') && legacyEffectsEnabled === undefined) {
    normalized.effectsEnabled = state.adjustmentSnapshot.value.effectsEnabled;
  }
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
    operations: [
      {
        editDocumentV2: legacyAdjustmentsToEditDocumentV2(resetAdjustments),
        type: 'replace-edit-document',
      },
    ],
    persistence: 'native-committed',
    source: 'reset',
    transactionId,
  };
};
