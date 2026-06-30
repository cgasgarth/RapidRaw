import {
  NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  type NegativeLabDustScratchReviewReport,
  type NegativeLabWorkspaceProof,
} from '../../schemas/negative-lab/negativeLabWorkspaceSchemas';

import type { NegativeLabQcContactSheetArtifact } from './negativeLabQcContactSheetArtifact';

export interface NegativeLabExportReadinessInput {
  baseReady: boolean;
  batchPlanAccepted: boolean;
  isLoading: boolean;
  isSaving: boolean;
  pathCount: number;
  previewReady: boolean;
  requiresAcceptedBatchPlan: boolean;
}

export type NegativeLabSaveBlockedReasonKey =
  | 'modals.negativeConversion.agentDryRunBlocked'
  | 'modals.negativeConversion.basePending'
  | 'modals.negativeConversion.previewPending'
  | 'modals.negativeConversion.workflowExportBlocked';

export interface NegativeLabExportReadiness {
  canSave: boolean;
  saveBlockedReasonKey: NegativeLabSaveBlockedReasonKey | null;
}

export type NegativeLabPositiveVariant = NegativeLabQcContactSheetArtifact['positiveVariants'][number];

export const buildNegativeLabCanSave = ({
  baseReady,
  batchPlanAccepted,
  isLoading,
  isSaving,
  pathCount,
  previewReady,
  requiresAcceptedBatchPlan,
}: NegativeLabExportReadinessInput): boolean =>
  !isSaving &&
  !isLoading &&
  previewReady &&
  baseReady &&
  pathCount > 0 &&
  (!requiresAcceptedBatchPlan || batchPlanAccepted);

export const buildNegativeLabSaveBlockedReason = (
  input: NegativeLabExportReadinessInput & { canSave: boolean },
): NegativeLabSaveBlockedReasonKey | null => {
  if (input.canSave || input.isSaving) return null;
  if (input.isLoading || !input.previewReady) return 'modals.negativeConversion.previewPending';
  if (!input.baseReady) return 'modals.negativeConversion.basePending';
  if (input.pathCount === 0) return 'modals.negativeConversion.workflowExportBlocked';
  if (input.requiresAcceptedBatchPlan && !input.batchPlanAccepted)
    return 'modals.negativeConversion.agentDryRunBlocked';
  return 'modals.negativeConversion.workflowExportBlocked';
};

export const buildNegativeLabExportReadiness = ({
  baseReady,
  batchPlanAccepted,
  isLoading,
  isSaving,
  pathCount,
  previewReady,
  requiresAcceptedBatchPlan,
}: NegativeLabExportReadinessInput): NegativeLabExportReadiness => {
  const input = {
    baseReady,
    batchPlanAccepted,
    isLoading,
    isSaving,
    pathCount,
    previewReady,
    requiresAcceptedBatchPlan,
  };
  const canSave = buildNegativeLabCanSave(input);

  return {
    canSave,
    saveBlockedReasonKey: buildNegativeLabSaveBlockedReason({ ...input, canSave }),
  };
};

export const selectNegativeLabActivePositiveVariant = (
  positiveVariants: readonly NegativeLabPositiveVariant[],
  activeFrameId: string | null,
): NegativeLabPositiveVariant | null =>
  positiveVariants.find((variant) => variant.frameId === activeFrameId) ?? positiveVariants[0] ?? null;

export const buildNegativeLabWorkspaceProof = ({
  canSave,
  previewReady,
  queuedCount,
  reviewReport,
  targetCount,
}: {
  canSave: boolean;
  previewReady: boolean;
  queuedCount: number;
  reviewReport: NegativeLabDustScratchReviewReport;
  targetCount: number;
}): NegativeLabWorkspaceProof => ({
  activeStage: canSave ? 'export' : previewReady ? 'inspection' : 'colorInversion',
  exportReady: canSave,
  previewReady,
  queuedCount,
  reviewReport,
  schemaVersion: NEGATIVE_LAB_WORKSPACE_SCHEMA_VERSION,
  targetCount,
});

export const buildNegativeLabPositiveHandoffReadiness = ({
  activePositiveVariant,
  canSave,
  qcExportReady,
}: {
  activePositiveVariant: NegativeLabPositiveVariant | null;
  canSave: boolean;
  qcExportReady: boolean;
}): boolean =>
  canSave && qcExportReady && activePositiveVariant !== null && activePositiveVariant.warnings.length === 0;
