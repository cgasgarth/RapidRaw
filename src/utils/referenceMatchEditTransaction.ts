import { type EditDocumentV2, editDocumentLayersV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import { matchLookApplicationReceiptV1Schema } from '../../packages/rawengine-schema/src/referenceMatchRuntime';
import { selectEditDocumentNode } from './editDocumentSelectors';
import { patchEditDocumentV2Node } from './editDocumentV2';
import type { EditNodeOperation, EditTransactionRequest } from './editTransaction';
import {
  applyReferenceMatchProposal,
  createReferenceMatchAdjustmentLayer,
  createReferenceMatchAppliedDiffs,
  fingerprintReferenceMatchValue,
  getReferenceMatchAdjustmentValue,
  type ReferenceMatchGlobalAdjustments,
  type ReferenceMatchGroup,
  type ReferenceMatchProposal,
} from './referenceMatch';

export interface ReferenceMatchEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
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
  receipt: NonNullable<EditDocumentV2['provenance']['referenceMatchApplicationReceipt']>;
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

export const selectReferenceMatchGlobalAdjustments = (document: EditDocumentV2): ReferenceMatchGlobalAdjustments => ({
  contrast: selectEditDocumentNode(document, 'scene_global_color_tone').params['contrast'],
  exposure: selectEditDocumentNode(document, 'scene_global_color_tone').params['exposure'],
  saturation: selectEditDocumentNode(document, 'color_presence').params['saturation'],
  vibrance: selectEditDocumentNode(document, 'color_presence').params['vibrance'],
  whiteBalanceTechnical: selectEditDocumentNode(document, 'camera_input').params['whiteBalanceTechnical'],
});

export const applyReferenceMatchProposalToEditDocument = ({
  document,
  enabledGroups,
  impact,
  proposal,
}: {
  document: EditDocumentV2;
  enabledGroups: ReadonlySet<ReferenceMatchGroup>;
  impact: number;
  proposal: ReferenceMatchProposal;
}): EditDocumentV2 => {
  const applied = applyReferenceMatchProposal({
    adjustments: selectReferenceMatchGlobalAdjustments(document),
    enabledGroups,
    impact,
    proposal,
  });
  let next = patchEditDocumentV2Node(document, 'scene_global_color_tone', {
    contrast: applied.contrast,
    exposure: applied.exposure,
  });
  next = patchEditDocumentV2Node(next, 'color_presence', {
    saturation: applied.saturation,
    vibrance: applied.vibrance,
  });
  return patchEditDocumentV2Node(next, 'camera_input', {
    whiteBalanceTechnical: applied.whiteBalanceTechnical,
  });
};

const buildReferenceMatchGlobalOperations = (
  applied: ReferenceMatchGlobalAdjustments,
  receipt: NonNullable<EditDocumentV2['provenance']['referenceMatchApplicationReceipt']>,
): readonly EditNodeOperation[] => [
  {
    nodeType: 'scene_global_color_tone',
    patch: { contrast: applied.contrast, exposure: applied.exposure },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'color_presence',
    patch: { saturation: applied.saturation, vibrance: applied.vibrance },
    type: 'patch-edit-document-node',
  },
  {
    nodeType: 'camera_input',
    patch: { whiteBalanceTechnical: applied.whiteBalanceTechnical },
    type: 'patch-edit-document-node',
  },
  { receipt, type: 'set-reference-match-application-receipt' },
];

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
  const current = selectReferenceMatchGlobalAdjustments(state.editDocumentV2);
  const applied = applyReferenceMatchProposal({
    adjustments: current,
    enabledGroups,
    impact,
    proposal,
  });
  const appliedDiffs = createReferenceMatchAppliedDiffs({
    adjustments: current,
    enabledGroups,
    impact,
    proposal,
  });
  if (appliedDiffs.length === 0) return null;
  const receipt = matchLookApplicationReceiptV1Schema.parse({
    appliedDiffs,
    appliedAt,
    baseGraphFingerprint: fingerprintReferenceMatchValue(JSON.stringify(current)),
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
      operations: buildReferenceMatchGlobalOperations(applied, receipt),
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
  const current = selectReferenceMatchGlobalAdjustments(state.editDocumentV2);
  const appliedDiffs = createReferenceMatchAppliedDiffs({
    adjustments: current,
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
    baseGraphFingerprint: fingerprintReferenceMatchValue(JSON.stringify(current)),
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
          patch: editDocumentLayersV2Schema.parse({ masks: [layer, ...state.editDocumentV2.layers.masks] }),
          type: 'patch-edit-document-node',
        },
      ],
      persistence: 'commit',
      source: 'reference-match',
      transactionId,
    },
  };
};
