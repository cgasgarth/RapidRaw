import {
  type EditDocumentEditorSection,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  getEditDocumentNodeDescriptor,
  getEditDocumentNodeTypesForEditorSection,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import {
  legacyAdjustmentsToEditDocumentV2,
  pasteEditDocumentV2Node,
  setEditDocumentV2NodeEnabled,
  updateEditDocumentV2Node,
} from './editDocumentV2';
import type { EditHistoryCheckpoint } from './editHistory';

/** The caller's intent, kept explicit so new mutation paths can be audited. */
export type EditMutationSource =
  | 'manual-control'
  | 'picker'
  | 'geometry-tool'
  | 'auto-edit'
  | 'preset'
  | 'copy-paste'
  | 'film-workspace'
  | 'layer-command'
  | 'reference-match'
  | 'ai-edit'
  | 'agent-command'
  | 'reset'
  | 'history'
  | 'hydration'
  | 'migration';

export type EditTransactionHistory =
  | 'single-entry'
  | 'coalesced-interaction'
  | 'navigation'
  | 'compensation'
  | 'none'
  | 'reset';
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
  | { type: 'set-edit-document-node-enabled'; nodeType: EditDocumentNodeTypeV2; enabled: boolean }
  | { type: 'replace-edit-document-node'; nodeType: EditDocumentNodeTypeV2; node: unknown }
  | { type: 'patch-adjustments'; patch: Partial<Adjustments> }
  | { type: 'replace-edit-authority'; adjustments: Adjustments; editDocumentV2: EditDocumentV2 }
  | { type: 'replace-adjustments'; adjustments: Adjustments };

export const buildEditorSectionNodeEnablementOperations = (
  document: EditDocumentV2,
  section: EditDocumentEditorSection,
  enabled: boolean,
): readonly EditNodeOperation[] =>
  getEditDocumentNodeTypesForEditorSection(section).flatMap((nodeType) =>
    document.nodes[nodeType]?.enabled === enabled
      ? []
      : [{ enabled, nodeType, type: 'set-edit-document-node-enabled' as const }],
  );

export interface EditTransactionRequest {
  transactionId: string;
  imageSessionId: string;
  baseAdjustmentRevision: number;
  source: EditMutationSource;
  operations: readonly EditNodeOperation[];
  history: EditTransactionHistory;
  /** Required only for history navigation; points at the canonical entry installed by this transaction. */
  historyTargetIndex?: number;
  /** Required only for compensation; restores the exact authority captured before a failed optimistic commit. */
  compensationHistory?: {
    checkpoints: readonly EditHistoryCheckpoint[];
    editDocumentEntries: readonly EditDocumentV2[];
    entries: readonly Adjustments[];
    historyIndex: number;
  };
  persistence: EditTransactionPersistence;
  /**
   * Native commits can win a same-path reopen race before the editor installs
   * their history boundary. Preserve the pre-commit document so that the
   * already-hydrated result still becomes one atomic, undoable transaction.
   */
  nativeCommittedHistoryBaseline?: Adjustments;
  nativeCommittedEditDocumentHistoryBaseline?: EditDocumentV2;
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

const sameAdjustmentValue = (before: unknown, after: unknown): boolean => {
  if (Object.is(before, after)) return true;
  if (Array.isArray(before) || Array.isArray(after)) {
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((value, index) => sameAdjustmentValue(value, after[index]))
    );
  }
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
  const beforeEntries = Object.entries(before);
  const afterRecord = after as Record<string, unknown>;
  return (
    beforeEntries.length === Object.keys(afterRecord).length &&
    beforeEntries.every(
      ([key, value]) => Object.hasOwn(afterRecord, key) && sameAdjustmentValue(value, afterRecord[key]),
    )
  );
};

export const areEditDocumentsEqual = (before: EditDocumentV2 | undefined, after: EditDocumentV2 | undefined): boolean =>
  before !== undefined && after !== undefined && sameAdjustmentValue(before, after);

const changedKeys = (before: Adjustments, after: Adjustments): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => !sameAdjustmentValue(before[key as keyof Adjustments], after[key as keyof Adjustments]),
  );

/**
 * Project only one authoritative node back through the compatibility surface.
 * Unmigrated domains still live in the flat bag, so rebuilding that whole bag
 * from a document captured before their latest edit would erase valid state.
 */
const projectEditDocumentNodeToAdjustments = (
  before: Adjustments,
  document: EditDocumentV2,
  nodeType: EditDocumentNodeTypeV2,
): Adjustments => {
  const descriptor = getEditDocumentNodeDescriptor(nodeType);
  const node = document.nodes[nodeType];
  if (descriptor === undefined || node === undefined) throw new Error(`edit_transaction.unknown_node:${nodeType}`);

  const projected: Record<string, unknown> = {};
  for (const field of descriptor.legacyFields) {
    if (Object.hasOwn(node.params, field)) projected[field] = structuredClone(node.params[field]);
  }
  // biome-ignore lint/complexity/useLiteralKeys: projected is an intentional index-signature bridge.
  if (nodeType === 'display_creative') projected['effectsEnabled'] = node.enabled;
  return { ...before, ...projected };
};

const replaceLegacyAdjustmentsPreservingNodeEnablement = (
  adjustments: Adjustments,
  currentDocument: EditDocumentV2,
): EditDocumentV2 => {
  let replacement = legacyAdjustmentsToEditDocumentV2(adjustments);
  for (const nodeType of Object.keys(replacement.nodes) as EditDocumentNodeTypeV2[]) {
    // Effects has an explicit flat compatibility field; every other enabled
    // bit remains node-owned across a legacy flat mutation boundary.
    if (nodeType === 'display_creative') continue;
    const enabled = currentDocument.nodes[nodeType]?.enabled;
    if (enabled !== undefined) replacement = setEditDocumentV2NodeEnabled(replacement, nodeType, enabled);
  }
  return replacement;
};

/** Route a focused migrated-node edit without widening it back into flat replacement authority. */
export const buildAdjustmentMutationOperations = (
  before: Adjustments,
  after: Adjustments,
): readonly EditNodeOperation[] => {
  const keys = changedKeys(before, after);
  if (keys.length === 1 && keys[0] === 'effectsEnabled') {
    return [
      {
        enabled: after.effectsEnabled,
        nodeType: 'display_creative',
        type: 'set-edit-document-node-enabled',
      },
    ];
  }
  const focusedNodeType = (
    [
      'black_white_mixer',
      'scene_global_color_tone',
      'camera_input',
      'color_calibration',
      'channel_mixer',
      'color_balance_rgb',
      'luma_levels',
      'scene_curve',
      'tone_equalizer',
      'point_color',
      'lens_correction',
      'perceptual_grading',
      'geometry',
    ] as const
  ).find((nodeType) => {
    const descriptor = getEditDocumentNodeDescriptor(nodeType);
    return (
      descriptor !== undefined &&
      keys.length > 0 &&
      keys.every((key) => descriptor.legacyFields.some((field) => field === key))
    );
  });
  if (focusedNodeType === undefined) return [{ type: 'replace-adjustments', adjustments: after }];
  return [
    {
      type: 'patch-edit-document-node',
      nodeType: focusedNodeType,
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

  let after = before;
  let afterEditDocumentV2 = currentEditDocumentV2;
  const documentChangedKeys: string[] = [];
  for (const operation of request.operations) {
    if (operation.type === 'replace-edit-authority') {
      after = structuredClone(operation.adjustments);
      afterEditDocumentV2 = structuredClone(operation.editDocumentV2);
      continue;
    }
    if (operation.type === 'replace-adjustments') {
      const replacedAdjustments = structuredClone(operation.adjustments);
      if (changedKeys(after, replacedAdjustments).length > 0) {
        after = replacedAdjustments;
        afterEditDocumentV2 = replaceLegacyAdjustmentsPreservingNodeEnablement(after, afterEditDocumentV2);
      } else {
        after = replacedAdjustments;
      }
      continue;
    }
    if (operation.type === 'patch-edit-document-node') {
      assertNodePatch(operation.nodeType, operation.patch);
      const patchedDocument = updateEditDocumentV2Node(afterEditDocumentV2, operation.nodeType, (params) => ({
        ...params,
        ...structuredClone(operation.patch),
      }));
      const patchMatchesFlatAuthority = Object.entries(operation.patch).every(([key, value]) =>
        sameAdjustmentValue(after[key as keyof Adjustments], value),
      );
      if (!sameAdjustmentValue(afterEditDocumentV2, patchedDocument) || !patchMatchesFlatAuthority) {
        afterEditDocumentV2 = patchedDocument;
        after = projectEditDocumentNodeToAdjustments(after, afterEditDocumentV2, operation.nodeType);
      }
      continue;
    }
    if (operation.type === 'set-edit-document-node-enabled') {
      const previousEnabled = afterEditDocumentV2.nodes[operation.nodeType]?.enabled;
      afterEditDocumentV2 = setEditDocumentV2NodeEnabled(afterEditDocumentV2, operation.nodeType, operation.enabled);
      // Effects has an explicit compatibility field. Other node enablement is
      // document-only authority and must not churn the flat adjustment bag.
      if (operation.nodeType === 'display_creative') {
        after = projectEditDocumentNodeToAdjustments(after, afterEditDocumentV2, operation.nodeType);
      }
      if (previousEnabled !== undefined && previousEnabled !== operation.enabled) {
        documentChangedKeys.push(`nodes.${operation.nodeType}.enabled`);
      }
      continue;
    }
    if (operation.type === 'replace-edit-document-node') {
      const replacedDocument = pasteEditDocumentV2Node(afterEditDocumentV2, operation.nodeType, operation.node);
      if (replacedDocument !== afterEditDocumentV2) {
        afterEditDocumentV2 = replacedDocument;
        after = projectEditDocumentNodeToAdjustments(after, afterEditDocumentV2, operation.nodeType);
        if (
          (request.source === 'copy-paste' || request.source === 'preset') &&
          afterEditDocumentV2.provenance.referenceMatchApplicationReceipt !== null
        ) {
          afterEditDocumentV2 = {
            ...afterEditDocumentV2,
            provenance: { ...afterEditDocumentV2.provenance, referenceMatchApplicationReceipt: null },
          };
          after = { ...after, referenceMatchApplicationReceipt: null };
        }
      }
      continue;
    }
    assertFinitePatch(operation.patch);
    const patchedAdjustments = { ...after, ...structuredClone(operation.patch) };
    if (changedKeys(after, patchedAdjustments).length > 0) {
      after = patchedAdjustments;
      afterEditDocumentV2 = replaceLegacyAdjustmentsPreservingNodeEnablement(after, afterEditDocumentV2);
    }
  }

  const flatChangedKeys = changedKeys(before, after);
  for (const nodeType of Object.keys({
    ...currentEditDocumentV2.nodes,
    ...afterEditDocumentV2.nodes,
  }) as EditDocumentNodeTypeV2[]) {
    if (currentEditDocumentV2.nodes[nodeType]?.enabled !== afterEditDocumentV2.nodes[nodeType]?.enabled) {
      documentChangedKeys.push(`nodes.${nodeType}.enabled`);
    }
  }
  if (
    flatChangedKeys.length === 0 &&
    documentChangedKeys.length === 0 &&
    !sameAdjustmentValue(currentEditDocumentV2, afterEditDocumentV2)
  ) {
    documentChangedKeys.push('editDocumentV2');
  }
  const keys = [...new Set([...flatChangedKeys, ...documentChangedKeys])];
  const invalidatedStages: EditInvalidationStage[] = keys.length === 0 ? [] : ['preview', 'navigator', 'thumbnail'];
  if (
    keys.some((key) =>
      [
        'aspectRatio',
        'crop',
        'rotation',
        'orientationSteps',
        'flipHorizontal',
        'flipVertical',
        'lensCorrectionMode',
        'lensDistortionAmount',
        'lensDistortionEnabled',
        'lensDistortionParams',
        'lensMaker',
        'lensModel',
        'lensTcaAmount',
        'lensTcaEnabled',
        'lensVignetteAmount',
        'lensVignetteEnabled',
        'perspectiveCorrection',
      ].includes(key),
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
