import {
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  getEditDocumentNodeDescriptor,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import {
  editDocumentV2ToLegacyAdjustments,
  legacyAdjustmentsToEditDocumentV2,
  updateEditDocumentV2Node,
} from './editDocumentV2';

/** The caller's intent, kept explicit so new mutation paths can be audited. */
export type EditMutationSource =
  | 'manual-control'
  | 'picker'
  | 'auto-edit'
  | 'preset'
  | 'copy-paste'
  | 'film-workspace'
  | 'layer-command'
  | 'reset'
  | 'history'
  | 'hydration'
  | 'migration';

export type EditTransactionHistory = 'single-entry' | 'coalesced-interaction' | 'none' | 'reset';
export type EditTransactionPersistence = 'commit' | 'native-committed' | 'preview-only';

/**
 * Operations intentionally describe adjustment intent rather than a store update.
 * `patch-adjustments` is the compatibility adapter used during migration; node-keyed
 * operations can be added without reintroducing another mutation authority.
 */
export type EditNodeOperation =
  | {
      type: 'patch-edit-document-node';
      nodeType: EditDocumentNodeTypeV2;
      patch: Readonly<Record<string, unknown>>;
    }
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
  imageSessionId: string;
  source: EditMutationSource;
  before: Adjustments;
  after: Adjustments;
  beforeEditDocumentV2: EditDocumentV2;
  afterEditDocumentV2: EditDocumentV2;
  changedKeys: readonly string[];
  nextAdjustmentRevision: number;
  noOp: boolean;
  invalidatedStages: readonly EditInvalidationStage[];
  invalidatedProvenance: readonly string[];
  applicationReceipt: EditApplicationReceipt;
}

export type EditInvalidationStage = 'preview' | 'navigator' | 'thumbnail' | 'geometry';

export interface EditApplicationReceipt {
  transactionId: string;
  imageSessionId: string;
  source: EditMutationSource;
  baseAdjustmentRevision: number;
  adjustmentRevision: number;
  changedKeys: readonly string[];
  persistence: EditTransactionPersistence;
}

export interface EditTransactionPersistenceContext {
  transactionId: string;
  imageSessionId: string;
  baseAdjustmentRevision: number;
  nextAdjustmentRevision: number;
}

export const buildEditTransactionPersistenceContext = (
  request: Pick<EditTransactionRequest, 'transactionId' | 'imageSessionId' | 'baseAdjustmentRevision'>,
  result: Pick<EditTransactionResult, 'nextAdjustmentRevision'> | Pick<EditApplicationReceipt, 'adjustmentRevision'>,
): EditTransactionPersistenceContext => ({
  transactionId: request.transactionId,
  imageSessionId: request.imageSessionId,
  baseAdjustmentRevision: request.baseAdjustmentRevision,
  nextAdjustmentRevision:
    'nextAdjustmentRevision' in result ? result.nextAdjustmentRevision : result.adjustmentRevision,
});

const assertFinitePatch = (patch: Partial<Adjustments>): void => {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`edit_transaction.invalid_value:${key}`);
    }
  }
};

const assertNodePatch = (nodeType: EditDocumentNodeTypeV2, patch: Readonly<Record<string, unknown>>): void => {
  const descriptor = getEditDocumentNodeDescriptor(nodeType);
  if (descriptor === undefined) throw new Error(`edit_transaction.unknown_node:${nodeType}`);
  for (const [key, value] of Object.entries(patch)) {
    if (!descriptor.legacyFields.some((field) => field === key)) {
      throw new Error(`edit_transaction.field_not_owned:${nodeType}:${key}`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`edit_transaction.invalid_value:${nodeType}.${key}`);
    }
  }
};

const changedKeys = (before: Adjustments, after: Adjustments): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) =>
    Object.is(before[key as keyof Adjustments], after[key as keyof Adjustments])
      ? false
      : JSON.stringify(before[key as keyof Adjustments]) !== JSON.stringify(after[key as keyof Adjustments]),
  );

/** Route a focused migrated-node edit without widening it back into flat replacement authority. */
export const buildAdjustmentMutationOperations = (
  before: Adjustments,
  after: Adjustments,
): readonly EditNodeOperation[] => {
  const keys = changedKeys(before, after);
  const descriptor = getEditDocumentNodeDescriptor('scene_global_color_tone');
  const isFocusedSceneNodeEdit =
    descriptor !== undefined &&
    keys.length > 0 &&
    keys.every((key) => descriptor.legacyFields.some((field) => field === key));
  if (!isFocusedSceneNodeEdit) return [{ type: 'replace-adjustments', adjustments: after }];
  return [
    {
      type: 'patch-edit-document-node',
      nodeType: 'scene_global_color_tone',
      patch: Object.fromEntries(keys.map((key) => [key, after[key]])),
    },
  ];
};

/** Reduce one revision-checked request without touching Zustand or persistence. */
export const reduceEditTransaction = (
  before: Adjustments,
  currentAdjustmentRevision: number,
  request: EditTransactionRequest,
  currentImageSessionId?: string,
  currentEditDocumentV2: EditDocumentV2 = legacyAdjustmentsToEditDocumentV2(before),
): EditTransactionResult => {
  if (request.baseAdjustmentRevision !== currentAdjustmentRevision) {
    throw new Error(
      `edit_transaction.stale_base:${String(request.baseAdjustmentRevision)}:${String(currentAdjustmentRevision)}`,
    );
  }
  if (request.operations.length === 0) throw new Error('edit_transaction.empty_operations');
  if (currentImageSessionId !== undefined && request.imageSessionId !== currentImageSessionId) {
    throw new Error(`edit_transaction.stale_session:${request.imageSessionId}:${currentImageSessionId}`);
  }

  let after = structuredClone(before);
  let afterEditDocumentV2 = currentEditDocumentV2;
  for (const operation of request.operations) {
    if (operation.type === 'replace-adjustments') {
      after = structuredClone(operation.adjustments);
      afterEditDocumentV2 = legacyAdjustmentsToEditDocumentV2(after);
      continue;
    }
    if (operation.type === 'patch-edit-document-node') {
      assertNodePatch(operation.nodeType, operation.patch);
      afterEditDocumentV2 = updateEditDocumentV2Node(afterEditDocumentV2, operation.nodeType, (params) => ({
        ...params,
        ...structuredClone(operation.patch),
      }));
      after = editDocumentV2ToLegacyAdjustments(afterEditDocumentV2);
      continue;
    }
    assertFinitePatch(operation.patch);
    after = { ...after, ...structuredClone(operation.patch) };
    afterEditDocumentV2 = legacyAdjustmentsToEditDocumentV2(after);
  }

  const keys = changedKeys(before, after);
  const invalidatedStages: EditInvalidationStage[] = keys.length === 0 ? [] : ['preview', 'navigator', 'thumbnail'];
  if (
    keys.some((key) =>
      ['crop', 'rotation', 'orientationSteps', 'flipHorizontal', 'flipVertical', 'perspectiveCorrection'].includes(key),
    )
  ) {
    invalidatedStages.push('geometry');
  }
  const invalidatedProvenance = keys.length === 0 ? [] : ['reference-match', 'auto-edit', 'derived-render'];
  const nextAdjustmentRevision = currentAdjustmentRevision + (keys.length > 0 ? 1 : 0);
  return {
    transactionId: request.transactionId,
    imageSessionId: request.imageSessionId,
    source: request.source,
    before,
    after,
    beforeEditDocumentV2: currentEditDocumentV2,
    afterEditDocumentV2,
    changedKeys: keys,
    nextAdjustmentRevision,
    noOp: keys.length === 0,
    invalidatedStages,
    invalidatedProvenance,
    applicationReceipt: {
      transactionId: request.transactionId,
      imageSessionId: request.imageSessionId,
      source: request.source,
      baseAdjustmentRevision: currentAdjustmentRevision,
      adjustmentRevision: nextAdjustmentRevision,
      changedKeys: keys,
      persistence: request.persistence,
    },
  };
};
