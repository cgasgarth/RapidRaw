import type { Adjustments } from './adjustments';

/** The caller's intent, kept explicit so new mutation paths can be audited. */
export type EditMutationSource =
  | 'manual-control'
  | 'auto-edit'
  | 'preset'
  | 'copy-paste'
  | 'reset'
  | 'history'
  | 'hydration'
  | 'migration';

export type EditTransactionHistory = 'single-entry' | 'coalesced-interaction' | 'none';
export type EditTransactionPersistence = 'commit' | 'preview-only';

/**
 * Operations intentionally describe adjustment intent rather than a store update.
 * `patch-adjustments` is the compatibility adapter used during migration; node-keyed
 * operations can be added without reintroducing another mutation authority.
 */
export type EditNodeOperation =
  | { type: 'patch-adjustments'; patch: Partial<Adjustments> }
  | { type: 'replace-adjustments'; adjustments: Adjustments };

export interface EditTransactionRequest {
  transactionId: string;
  imageSessionId: string;
  baseAdjustmentRevision: number;
  source: EditMutationSource;
  operations: readonly EditNodeOperation[];
  history: EditTransactionHistory;
  persistence: EditTransactionPersistence;
}

export interface EditTransactionResult {
  transactionId: string;
  source: EditMutationSource;
  before: Adjustments;
  after: Adjustments;
  changedKeys: readonly string[];
  nextAdjustmentRevision: number;
  noOp: boolean;
}

const assertFinitePatch = (patch: Partial<Adjustments>): void => {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`edit_transaction.invalid_value:${key}`);
    }
  }
};

const changedKeys = (before: Adjustments, after: Adjustments): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) =>
    Object.is(before[key as keyof Adjustments], after[key as keyof Adjustments])
      ? false
      : JSON.stringify(before[key as keyof Adjustments]) !== JSON.stringify(after[key as keyof Adjustments]),
  );

/** Reduce one revision-checked request without touching Zustand or persistence. */
export const reduceEditTransaction = (
  before: Adjustments,
  currentAdjustmentRevision: number,
  request: EditTransactionRequest,
): EditTransactionResult => {
  if (request.baseAdjustmentRevision !== currentAdjustmentRevision) {
    throw new Error(
      `edit_transaction.stale_base:${String(request.baseAdjustmentRevision)}:${String(currentAdjustmentRevision)}`,
    );
  }
  if (request.operations.length === 0) throw new Error('edit_transaction.empty_operations');

  let after = structuredClone(before);
  for (const operation of request.operations) {
    if (operation.type === 'replace-adjustments') {
      after = structuredClone(operation.adjustments);
      continue;
    }
    assertFinitePatch(operation.patch);
    after = { ...after, ...structuredClone(operation.patch) };
  }

  const keys = changedKeys(before, after);
  return {
    transactionId: request.transactionId,
    source: request.source,
    before,
    after,
    changedKeys: keys,
    nextAdjustmentRevision: currentAdjustmentRevision + (keys.length > 0 ? 1 : 0),
    noOp: keys.length === 0,
  };
};
