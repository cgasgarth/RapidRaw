import type { AdjustmentSnapshot } from './adjustmentSnapshots';
import { publishAdjustmentSnapshot } from './adjustmentSnapshots';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';

export interface AutoEditProposalBase {
  adjustmentRevision: number;
  adjustments: Adjustments;
  graphRevision: string;
  imageSessionId: string;
  path: string;
}

export interface AutoEditPreviewSession {
  baseAdjustmentRevision: number;
  baseGraphRevision: string;
  baseSnapshotAdjustmentRevision: number;
  bypassed: boolean;
  imageSessionId: string;
  key: string;
  previewIdentity: string;
  proposalId: string;
  snapshot: AdjustmentSnapshot;
  targetPath: string;
}

interface AutoEditPreviewInput {
  adjustments: Adjustments;
  base: AutoEditProposalBase;
  committedSnapshot: AdjustmentSnapshot;
  currentAdjustmentRevision: number;
  previewIdentity: string;
  proposalId: string;
}

export const autoEditPreviewSessionKey = (
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
    baseSnapshotAdjustmentRevision: committedSnapshot.adjustmentRevision,
    bypassed: false,
    key: autoEditPreviewSessionKey(identity),
    previewIdentity,
    snapshot: publishAdjustmentSnapshot(committedSnapshot, adjustments),
  };
};

export const isCurrentAutoEditPreviewSession = (
  session: AutoEditPreviewSession,
  current: { imageSessionId: string | null; path: string | null; snapshotAdjustmentRevision: number },
): boolean =>
  session.baseSnapshotAdjustmentRevision === current.snapshotAdjustmentRevision &&
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
    snapshotAdjustmentRevision: committedSnapshot.adjustmentRevision,
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
  adjustments: Adjustments,
  transactionId: string,
): EditTransactionRequest => ({
  baseAdjustmentRevision: base.adjustmentRevision,
  history: 'single-entry',
  imageSessionId: base.imageSessionId,
  operations: [{ adjustments, type: 'replace-adjustments' }],
  persistence: 'commit',
  source: 'auto-edit',
  transactionId,
});
