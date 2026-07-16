import type { EditDocumentNodeParamsV2, EditDocumentV2 } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { AdjustmentSnapshot } from './adjustmentSnapshots';
import { publishAdjustmentSnapshot } from './adjustmentSnapshots';
import type { Adjustments } from './adjustments';
import { type EditNodeOperation, type EditTransactionRequest, reduceEditTransaction } from './editTransaction';

const buildAutoEditNodeOperations = (adjustments: Adjustments): readonly EditNodeOperation[] => [
  {
    nodeType: 'scene_global_color_tone',
    patch: {
      blacks: adjustments.blacks,
      brightness: adjustments.brightness,
      contrast: adjustments.contrast,
      exposure: adjustments.exposure,
      highlights: adjustments.highlights,
      shadows: adjustments.shadows,
      whites: adjustments.whites,
    },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'detail_denoise_dehaze',
    patch: { centré: adjustments.centré, clarity: adjustments.clarity, dehaze: adjustments.dehaze },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'color_presence',
    patch: { vibrance: adjustments.vibrance },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'display_creative',
    patch: { vignetteAmount: adjustments.vignetteAmount },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'camera_input',
    patch: { whiteBalanceTechnical: adjustments.whiteBalanceTechnical },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'black_white_mixer',
    patch: { blackWhiteMixer: adjustments.blackWhiteMixer },
    type: 'patch-edit-document-node',
  },
  { receipt: null, type: 'set-reference-match-application-receipt' },
];

export interface AutoEditProposalBase {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  graphRevision: string;
  imageSessionId: string;
  path: string;
}

export interface AutoEditProposalState {
  adjustmentRevision: number;
  readonly editDocumentV2: EditDocumentV2;
  historyIndex: number;
  imageSession: { id: string } | null;
  imageSessionId: number;
  selectedImage: { isReady: boolean; path: string } | null;
}

export const currentAutoEditImageSessionId = (state: AutoEditProposalState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureAutoEditProposalBase = (state: AutoEditProposalState): AutoEditProposalBase | null =>
  state.selectedImage?.isReady === true
    ? {
        adjustmentRevision: state.adjustmentRevision,
        editDocumentV2: state.editDocumentV2,
        graphRevision: `history_${String(state.historyIndex)}`,
        imageSessionId: currentAutoEditImageSessionId(state),
        path: state.selectedImage.path,
      }
    : null;

export const isCurrentAutoEditProposalBase = (state: AutoEditProposalState, base: AutoEditProposalBase): boolean =>
  state.adjustmentRevision === base.adjustmentRevision &&
  `history_${String(state.historyIndex)}` === base.graphRevision &&
  currentAutoEditImageSessionId(state) === base.imageSessionId &&
  state.selectedImage?.path === base.path;

export const isCurrentAutoEditProposalRequest = (
  state: AutoEditProposalState,
  base: AutoEditProposalBase,
  requestGeneration: number,
  currentRequestGeneration: number,
): boolean => requestGeneration === currentRequestGeneration && isCurrentAutoEditProposalBase(state, base);

export interface AutoEditPreviewSession {
  baseAdjustmentRevision: number;
  baseGraphRevision: string;
  baseSnapshotRenderRevision: number;
  bypassed: boolean;
  imageSessionId: string;
  key: string;
  previewIdentity: string;
  proposalId: string;
  snapshot: AdjustmentSnapshot;
  targetPath: string;
}

interface AutoEditPreviewInput {
  adjustments: AutoEditAdjustmentProposal;
  base: AutoEditProposalBase;
  committedSnapshot: AdjustmentSnapshot;
  currentAdjustmentRevision: number;
  previewIdentity: string;
  proposalId: string;
}

const autoEditPreviewSessionKey = (
  identity: Pick<AutoEditPreviewSession, 'baseAdjustmentRevision' | 'imageSessionId' | 'proposalId' | 'targetPath'>,
): string =>
  JSON.stringify([identity.imageSessionId, identity.targetPath, identity.baseAdjustmentRevision, identity.proposalId]);

export const createAutoEditPreviewSession = ({
  adjustments,
  base,
  committedSnapshot,
  currentAdjustmentRevision,
  previewIdentity,
  proposalId,
}: AutoEditPreviewInput): AutoEditPreviewSession => {
  if (currentAdjustmentRevision !== base.adjustmentRevision) {
    throw new Error(
      `auto_edit_preview.stale_base:${String(base.adjustmentRevision)}:${String(currentAdjustmentRevision)}`,
    );
  }
  const identity = {
    baseAdjustmentRevision: base.adjustmentRevision,
    imageSessionId: base.imageSessionId,
    proposalId,
    targetPath: base.path,
  };
  return {
    ...identity,
    baseGraphRevision: base.graphRevision,
    baseSnapshotRenderRevision: committedSnapshot.renderRevision,
    bypassed: false,
    key: autoEditPreviewSessionKey(identity),
    previewIdentity,
    snapshot: publishAdjustmentSnapshot(
      committedSnapshot,
      reduceEditTransaction(
        structuredClone(committedSnapshot.editDocumentV2),
        base.adjustmentRevision,
        {
          baseAdjustmentRevision: base.adjustmentRevision,
          history: 'none',
          imageSessionId: base.imageSessionId,
          operations: buildAutoEditNodeOperations(adjustments),
          persistence: 'preview-only',
          source: 'auto-edit',
          transactionId: `auto-edit-preview:${proposalId}`,
        },
        base.imageSessionId,
      ).after,
    ),
  };
};

const isCurrentAutoEditPreviewSession = (
  session: AutoEditPreviewSession,
  current: { imageSessionId: string | null; path: string | null; snapshotRenderRevision: number },
): boolean =>
  session.baseSnapshotRenderRevision === current.snapshotRenderRevision &&
  session.imageSessionId === current.imageSessionId &&
  session.targetPath === current.path;

export const resolveAutoEditRenderSnapshot = (
  committedSnapshot: AdjustmentSnapshot,
  session: AutoEditPreviewSession | null,
  current: { imageSessionId: string | null; path: string | null },
): AdjustmentSnapshot =>
  session !== null &&
  !session.bypassed &&
  isCurrentAutoEditPreviewSession(session, {
    imageSessionId: current.imageSessionId,
    path: current.path,
    snapshotRenderRevision: committedSnapshot.renderRevision,
  })
    ? session.snapshot
    : committedSnapshot;

export const setAutoEditPreviewBypass = (
  session: AutoEditPreviewSession | null,
  expectedKey: string,
  bypassed: boolean,
): AutoEditPreviewSession | null =>
  session?.key === expectedKey && session.bypassed !== bypassed ? { ...session, bypassed } : session;

export const clearAutoEditPreviewSession = (
  session: AutoEditPreviewSession | null,
  expectedKey: string,
): AutoEditPreviewSession | null => (session?.key === expectedKey ? null : session);

export const buildAutoEditTransactionRequest = (
  base: AutoEditProposalBase,
  adjustments: AutoEditAdjustmentProposal,
  transactionId: string,
): EditTransactionRequest => ({
  baseAdjustmentRevision: base.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: base.imageSessionId,
  operations: buildAutoEditNodeOperations(adjustments),
  persistence: 'commit',
  source: 'auto-edit',
  transactionId,
});
