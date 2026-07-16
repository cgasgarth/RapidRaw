import type { EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import {
  type SkinToneUniformityParamsV1,
  skinToneUniformityParamsV1Schema,
} from '../../packages/rawengine-schema/src/skinToneUniformitySchemas';
import type { EditTransactionRequest } from './editTransaction';

export interface SkinToneUniformityCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  sourceIdentity: string;
}

export interface SkinToneUniformityEditTransactionState {
  adjustmentRevision: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

const currentImageSessionId = (state: SkinToneUniformityEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const selectSkinToneUniformity = (document: EditDocumentV2): SkinToneUniformityParamsV1 => {
  // biome-ignore lint/complexity/useLiteralKeys: strict TS index-signature access is required for dynamic node maps.
  const node = document.nodes['skin_tone_uniformity'];
  if (node === undefined) throw new Error('skin_tone_uniformity.missing_node');
  // biome-ignore lint/complexity/useLiteralKeys: strict TS index-signature access is required for dynamic params.
  return skinToneUniformityParamsV1Schema.parse(node.params['skinToneUniformity']);
};

export const buildSkinToneUniformityEditTransaction = (
  state: SkinToneUniformityEditTransactionState,
  identity: SkinToneUniformityCommitIdentity,
  settings: unknown,
  transactionId: string,
): EditTransactionRequest => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `skin_tone_uniformity_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  if (currentImageSessionId(state) !== identity.imageSessionId) {
    throw new Error(
      `skin_tone_uniformity_transaction.stale_session:${identity.imageSessionId}:${currentImageSessionId(state)}`,
    );
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `skin_tone_uniformity_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  const skinToneUniformity = skinToneUniformityParamsV1Schema.parse(settings);
  return {
    baseAdjustmentRevision: identity.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: identity.imageSessionId,
    operations: [{ nodeType: 'skin_tone_uniformity', patch: { skinToneUniformity }, type: 'patch-edit-document-node' }],
    persistence: 'commit',
    source: 'manual-control',
    transactionId,
  };
};
