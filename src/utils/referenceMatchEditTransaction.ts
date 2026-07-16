import { matchLookApplicationReceiptV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import type { Adjustments } from './adjustments';
import type { EditTransactionRequest } from './editTransaction';
import {
  applyReferenceMatchProposal,
  createReferenceMatchAdjustmentLayer,
  createReferenceMatchAppliedDiffs,
  fingerprintReferenceMatchValue,
  getReferenceMatchAdjustmentValue,
  type ReferenceMatchGroup,
  type ReferenceMatchProposal,
} from './referenceMatch';

export interface ReferenceMatchEditTransactionState {
  adjustmentRevision: number;
  adjustments: Adjustments;
  imageSession?: { id: string } | null;
  imageSessionId: number;
  selectedImage: { path: string } | null;
}

export interface ReferenceMatchCommitIdentity {
  adjustmentRevision: number;
  imageSessionId: string;
  proposalFingerprint: string;
  sourceIdentity: string;
  targetAnalysisFingerprint: string;
}

export interface ReferenceMatchTransactionCommit {
  receipt: NonNullable<Adjustments['referenceMatchApplicationReceipt']>;
  request: EditTransactionRequest;
}

const currentImageSessionId = (state: ReferenceMatchEditTransactionState): string =>
  state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`;

export const captureReferenceMatchCommitIdentity = (
  state: ReferenceMatchEditTransactionState,
  proposal: ReferenceMatchProposal,
): ReferenceMatchCommitIdentity | null =>
  state.selectedImage === null
    ? null
    : {
        adjustmentRevision: state.adjustmentRevision,
        imageSessionId: currentImageSessionId(state),
        proposalFingerprint: proposal.proposalFingerprint,
        sourceIdentity: state.selectedImage.path,
        targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
      };

const assertReferenceMatchIdentity = (
  state: ReferenceMatchEditTransactionState,
  identity: ReferenceMatchCommitIdentity,
  proposal: ReferenceMatchProposal,
): void => {
  if (state.selectedImage?.path !== identity.sourceIdentity) {
    throw new Error(
      `reference_match_transaction.stale_source:${identity.sourceIdentity}:${state.selectedImage?.path ?? 'none'}`,
    );
  }
  const sessionId = currentImageSessionId(state);
  if (sessionId !== identity.imageSessionId) {
    throw new Error(`reference_match_transaction.stale_session:${identity.imageSessionId}:${sessionId}`);
  }
  if (state.adjustmentRevision !== identity.adjustmentRevision) {
    throw new Error(
      `reference_match_transaction.stale_revision:${String(identity.adjustmentRevision)}:${String(state.adjustmentRevision)}`,
    );
  }
  if (
    proposal.proposalFingerprint !== identity.proposalFingerprint ||
    proposal.targetAnalysisFingerprint !== identity.targetAnalysisFingerprint
  ) {
    throw new Error('reference_match_transaction.stale_proposal');
  }
};

const sortedGroups = (groups: ReadonlySet<ReferenceMatchGroup>): ReferenceMatchGroup[] => [...groups].sort();

export const buildReferenceMatchGlobalEditTransaction = ({
  appliedAt = new Date().toISOString(),
  enabledGroups,
  identity,
  impact,
  proposal,
  state,
  transactionId,
}: {
  appliedAt?: string;
  enabledGroups: ReadonlySet<ReferenceMatchGroup>;
  identity: ReferenceMatchCommitIdentity;
  impact: number;
  proposal: ReferenceMatchProposal;
  state: ReferenceMatchEditTransactionState;
  transactionId: string;
}): ReferenceMatchTransactionCommit | null => {
  assertReferenceMatchIdentity(state, identity, proposal);
  const applied = applyReferenceMatchProposal({ adjustments: state.adjustments, enabledGroups, impact, proposal });
  const appliedDiffs = createReferenceMatchAppliedDiffs({
    adjustments: state.adjustments,
    enabledGroups,
    impact,
    proposal,
  });
  if (appliedDiffs.length === 0) return null;
  const appliesWhiteBalance = appliedDiffs.some(
    (diff) => diff.key === 'whiteBalanceKelvin' || diff.key === 'whiteBalanceDuv',
  );
  const scalarPatch = Object.fromEntries(
    appliedDiffs
      .filter((diff) => diff.key !== 'whiteBalanceKelvin' && diff.key !== 'whiteBalanceDuv')
      .map((diff) => [diff.key, diff.after]),
  );
  const receipt = matchLookApplicationReceiptV1Schema.parse({
    appliedDiffs,
    appliedAt,
    baseGraphFingerprint: fingerprintReferenceMatchValue(JSON.stringify(state.adjustments)),
    destination: 'global-adjustments',
    effectiveReferences: proposal.effectiveReferences,
    enabledGroups: sortedGroups(enabledGroups),
    historyEntriesAdded: 1,
    impact,
    proposalFingerprint: proposal.proposalFingerprint,
    resultingGraphFingerprint: fingerprintReferenceMatchValue(
      JSON.stringify(proposal.diffs.map((diff) => [diff.key, getReferenceMatchAdjustmentValue(applied, diff.key)])),
    ),
    schemaVersion: 1,
    targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
  });
  return {
    receipt,
    request: {
      baseAdjustmentRevision: identity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: identity.imageSessionId,
      operations: [
        {
          patch: {
            ...scalarPatch,
            ...(appliesWhiteBalance ? { whiteBalanceTechnical: structuredClone(applied.whiteBalanceTechnical) } : {}),
            referenceMatchApplicationReceipt: receipt,
          },
          type: 'patch-adjustments',
        },
      ],
      persistence: 'commit',
      source: 'reference-match',
      transactionId,
    },
  };
};

export const buildReferenceMatchLayerEditTransaction = ({
  appliedAt = new Date().toISOString(),
  enabledGroups,
  identity,
  impact,
  layerId,
  layerName,
  proposal,
  state,
  transactionId,
}: {
  appliedAt?: string;
  enabledGroups: ReadonlySet<ReferenceMatchGroup>;
  identity: ReferenceMatchCommitIdentity;
  impact: number;
  layerId: string;
  layerName: string;
  proposal: ReferenceMatchProposal;
  state: ReferenceMatchEditTransactionState;
  transactionId: string;
}): ReferenceMatchTransactionCommit | null => {
  assertReferenceMatchIdentity(state, identity, proposal);
  const appliedDiffs = createReferenceMatchAppliedDiffs({
    adjustments: state.adjustments,
    enabledGroups,
    impact,
    proposal,
  });
  if (appliedDiffs.length === 0) return null;
  const layerWithoutReceipt = createReferenceMatchAdjustmentLayer({
    enabledGroups,
    id: layerId,
    impact,
    name: layerName,
    proposal,
  });
  const receipt = matchLookApplicationReceiptV1Schema.parse({
    appliedDiffs,
    appliedAt,
    baseGraphFingerprint: fingerprintReferenceMatchValue(JSON.stringify(state.adjustments)),
    destination: 'adjustment-layer',
    effectiveReferences: proposal.effectiveReferences,
    enabledGroups: sortedGroups(enabledGroups),
    historyEntriesAdded: 1,
    impact,
    layerId,
    proposalFingerprint: proposal.proposalFingerprint,
    resultingGraphFingerprint: fingerprintReferenceMatchValue(
      JSON.stringify({ adjustments: layerWithoutReceipt.adjustments, opacity: layerWithoutReceipt.opacity }),
    ),
    schemaVersion: 1,
    targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
  });
  const layer = createReferenceMatchAdjustmentLayer({
    enabledGroups,
    id: layerId,
    impact,
    name: layerName,
    proposal,
    receipt,
  });
  return {
    receipt,
    request: {
      baseAdjustmentRevision: identity.adjustmentRevision,
      history: 'single-entry',
      imageSessionId: identity.imageSessionId,
      operations: [
        {
          nodeType: 'layers',
          patch: { masks: [layer, ...state.adjustments.masks] },
          type: 'patch-edit-document-node',
        },
      ],
      persistence: 'commit',
      source: 'reference-match',
      transactionId,
    },
  };
};
