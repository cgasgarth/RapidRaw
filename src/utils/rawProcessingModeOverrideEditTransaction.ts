import {
  type EditDocumentV2,
  editDocumentSourceDecodeV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import {
  type RawProcessingModeOverrideV1,
  rawProcessingModeOverrideV1Schema,
} from '../../packages/rawengine-schema/src/rawProcessingModeSchemas';
import type { EditTransactionRequest } from './editTransaction';

export interface RawProcessingModeOverrideCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface RawProcessingModeOverrideEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: RawProcessingModeOverrideEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

/** Read the strict source-decode authority, rejecting split domain/node state. */
export const selectRawProcessingModeOverride = (document: EditDocumentV2): RawProcessingModeOverrideV1 => {
  const node = document.nodes['source_decode'];
  if (node === undefined) throw new Error('raw_processing_mode_override.missing_source_decode_node');
  const nodeParams = editDocumentSourceDecodeV2Schema.parse(node.params);
  const domain = editDocumentSourceDecodeV2Schema.parse(document.sourceDecode);
  if (nodeParams.rawProcessingModeOverride !== domain.rawProcessingModeOverride) {
    throw new Error('raw_processing_mode_override.split_authority');
  }
  return nodeParams.rawProcessingModeOverride;
};

/** Commit a source-decode choice as one focused, undoable, persistent edit. */
export const buildRawProcessingModeOverrideEditTransaction = (
  state: RawProcessingModeOverrideEditTransactionState,
  identity: RawProcessingModeOverrideCommitIdentity,
  value: unknown,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `raw_processing_mode_override_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `raw_processing_mode_override_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `raw_processing_mode_override_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  const rawProcessingModeOverride = rawProcessingModeOverrideV1Schema.parse(value);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [
      {
        nodeType: 'source_decode',
        patch: { rawProcessingModeOverride },
        type: 'patch-edit-document-node',
      },
    ],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
