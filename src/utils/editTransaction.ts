import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentEditorSection,
  type EditDocumentNodeEnvelopeV2,
  type EditDocumentNodeParamsV2,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  editDocumentProvenanceV2Schema,
  getEditDocumentNodeTypesForEditorSection,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import {
  type LayerStackSidecarPersistenceEnvelopeV1,
  layerStackSidecarPersistenceEnvelopeV1Schema,
} from '../../packages/rawengine-schema/src/layerStackSidecarPersistence';
import { pasteEditDocumentV2Node, patchEditDocumentV2Node, setEditDocumentV2NodeEnabled } from './editDocumentV2';
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
  | 'snapshot'
  | 'ai-edit'
  | 'agent-command'
  | 'reset'
  | 'history'
  | 'hydration';

export type EditTransactionHistory =
  | 'single-entry'
  | 'metadata'
  | 'coalesced-interaction'
  | 'navigation'
  | 'compensation'
  | 'none'
  | 'reset';
export type EditTransactionPersistence = 'commit' | 'native-committed' | 'preview-only';

type PatchEditDocumentNodeOperation = {
  [NodeType in EditDocumentNodeTypeV2]: {
    type: 'patch-edit-document-node';
    nodeType: NodeType;
    patch: Readonly<Partial<EditDocumentNodeParamsV2<NodeType>>>;
  };
}[EditDocumentNodeTypeV2];

type ReplaceEditDocumentNodeOperation = {
  [NodeType in EditDocumentNodeTypeV2]: {
    type: 'replace-edit-document-node';
    nodeType: NodeType;
    node: EditDocumentNodeEnvelopeV2;
  };
}[EditDocumentNodeTypeV2];

/** Every operation targets one typed node/domain or replaces the complete typed authority. */
export type EditNodeOperation =
  | PatchEditDocumentNodeOperation
  | { type: 'set-edit-document-node-enabled'; nodeType: EditDocumentNodeTypeV2; enabled: boolean }
  | {
      type: 'set-reference-match-application-receipt';
      receipt: EditDocumentV2['provenance']['referenceMatchApplicationReceipt'];
    }
  | {
      type: 'set-layer-stack-artifacts';
      rawEngineArtifacts: LayerStackSidecarPersistenceEnvelopeV1['rawEngineArtifacts'] | null;
    }
  | ReplaceEditDocumentNodeOperation
  | { type: 'replace-edit-document'; editDocumentV2: EditDocumentV2 };

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
    entries: readonly EditDocumentV2[];
    historyIndex: number;
  };
  persistence: EditTransactionPersistence;
  /**
   * Native commits can win a same-path reopen race before the editor installs
   * their history boundary. Preserve the pre-commit document so that the
   * already-hydrated result still becomes one atomic, undoable transaction.
   */
  nativeCommittedHistoryBaseline?: EditDocumentV2;
}

export interface EditTransactionResult {
  transactionId: string;
  imageSessionId: string;
  source: EditMutationSource;
  before: EditDocumentV2;
  after: EditDocumentV2;
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

export const sameAdjustmentValue = (before: unknown, after: unknown): boolean => {
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

const changedDocumentPaths = (before: EditDocumentV2, after: EditDocumentV2): readonly string[] => {
  const paths: string[] = [];
  for (const { nodeType } of EDIT_DOCUMENT_NODE_DESCRIPTORS) {
    const beforeNode = before.nodes[nodeType];
    const afterNode = after.nodes[nodeType];
    if (beforeNode === afterNode) continue;
    if (beforeNode?.enabled !== afterNode?.enabled) paths.push(`nodes.${nodeType}.enabled`);
    const beforeParams = beforeNode?.params ?? {};
    const afterParams = afterNode?.params ?? {};
    for (const key of new Set([...Object.keys(beforeParams), ...Object.keys(afterParams)])) {
      if (!sameAdjustmentValue(beforeParams[key], afterParams[key])) paths.push(`nodes.${nodeType}.params.${key}`);
    }
  }
  if (!sameAdjustmentValue(before.provenance, after.provenance)) paths.push('provenance');
  if (!sameAdjustmentValue(before.extensions, after.extensions)) paths.push('extensions');
  return paths;
};

/** Reduce one revision-checked request without touching Zustand or persistence. */
export const reduceEditTransaction = (
  currentEditDocumentV2: EditDocumentV2,
  currentAdjustmentRevision: number,
  request: EditTransactionRequest,
  currentImageSessionId?: string,
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

  let afterEditDocumentV2 = currentEditDocumentV2;
  for (const operation of request.operations) {
    if (operation.type === 'replace-edit-document') {
      afterEditDocumentV2 = operation.editDocumentV2;
      continue;
    }
    if (operation.type === 'patch-edit-document-node') {
      afterEditDocumentV2 = patchEditDocumentV2Node(afterEditDocumentV2, operation.nodeType, operation.patch);
      continue;
    }
    if (operation.type === 'set-edit-document-node-enabled') {
      afterEditDocumentV2 = setEditDocumentV2NodeEnabled(afterEditDocumentV2, operation.nodeType, operation.enabled);
      continue;
    }
    if (operation.type === 'set-reference-match-application-receipt') {
      if (afterEditDocumentV2.provenance.referenceMatchApplicationReceipt !== operation.receipt) {
        const provenance = editDocumentProvenanceV2Schema.parse({
          referenceMatchApplicationReceipt: operation.receipt,
        });
        afterEditDocumentV2 = {
          ...afterEditDocumentV2,
          provenance,
        };
      }
      continue;
    }
    if (operation.type === 'set-layer-stack-artifacts') {
      const rawEngineArtifacts =
        operation.rawEngineArtifacts === null
          ? null
          : layerStackSidecarPersistenceEnvelopeV1Schema.parse({
              rawEngineArtifacts: operation.rawEngineArtifacts,
            }).rawEngineArtifacts;
      if (!sameAdjustmentValue(afterEditDocumentV2.extensions['rawEngineArtifacts'], rawEngineArtifacts)) {
        const extensions = { ...afterEditDocumentV2.extensions };
        if (rawEngineArtifacts === null) delete extensions['rawEngineArtifacts'];
        else extensions['rawEngineArtifacts'] = rawEngineArtifacts;
        afterEditDocumentV2 = { ...afterEditDocumentV2, extensions };
      }
      continue;
    }
    if (operation.type === 'replace-edit-document-node') {
      const replacedDocument = pasteEditDocumentV2Node(afterEditDocumentV2, operation.nodeType, operation.node);
      if (replacedDocument !== afterEditDocumentV2) {
        afterEditDocumentV2 = replacedDocument;
        if (
          (request.source === 'copy-paste' || request.source === 'preset') &&
          afterEditDocumentV2.provenance.referenceMatchApplicationReceipt !== null
        ) {
          afterEditDocumentV2 = {
            ...afterEditDocumentV2,
            provenance: { ...afterEditDocumentV2.provenance, referenceMatchApplicationReceipt: null },
          };
        }
      }
    }
  }

  const keys = changedDocumentPaths(currentEditDocumentV2, afterEditDocumentV2);
  const invalidatedStages: EditInvalidationStage[] = keys.length === 0 ? [] : ['preview', 'navigator', 'thumbnail'];
  if (keys.some((key) => key.startsWith('nodes.geometry.') || key.startsWith('nodes.lens_correction.'))) {
    invalidatedStages.push('geometry');
  }
  const invalidatedProvenance = keys.length === 0 ? [] : ['reference-match', 'auto-edit', 'derived-render'];
  const nextAdjustmentRevision = currentAdjustmentRevision + (keys.length > 0 ? 1 : 0);
  return {
    transactionId: request.transactionId,
    imageSessionId: request.imageSessionId,
    source: request.source,
    before: currentEditDocumentV2,
    after: afterEditDocumentV2,
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
