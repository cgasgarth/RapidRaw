import { z } from 'zod';
import { useEditorStore } from '../store/useEditorStore';
import type { Adjustments } from './adjustments';
import { type AgentApprovalState, agentApprovalStateSchema, assertAgentApprovalGate } from './agentApprovalGate';
import { type AgentCoreEditCommandBundleStep, runAgentCoreEditCommandBundle } from './agentCoreEditCommandBundle';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';

export interface AgentApprovedPlan {
  approval: AgentApprovalState;
  approvedAfterHash: string;
  approvedBeforeHash: string;
  approvedGraphRevision: string;
  operationId: string;
  sessionId: string;
  steps: readonly AgentCoreEditCommandBundleStep[];
}

export interface AgentAtomicApplyResult {
  appliedGraphRevision: string;
  approvalId: string;
  rollbackTarget: {
    adjustments: Adjustments;
    graphRevision: string;
    historyIndex: number;
    previewUrl: string | null;
  };
}

const approvedPlanSchema = z
  .object({
    approval: agentApprovalStateSchema,
    approvedAfterHash: z.string().trim().min(1),
    approvedBeforeHash: z.string().trim().min(1),
    approvedGraphRevision: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    steps: z
      .array(
        z.custom<AgentCoreEditCommandBundleStep>(
          (value) =>
            typeof value === 'object' &&
            value !== null &&
            'payload' in value &&
            'kind' in value &&
            (value.kind === 'basic_tone' || value.kind === 'selective_color'),
        ),
      )
      .min(1),
  })
  .strict();

export const applyApprovedAgentPlanAtomically = async (plan: AgentApprovedPlan): Promise<AgentAtomicApplyResult> => {
  const parsedPlan = approvedPlanSchema.parse(plan);
  const snapshot = buildAgentImageContextSnapshot();
  const state = useEditorStore.getState();
  const currentGraphRevision = snapshot.graphRevision;
  if (currentGraphRevision !== parsedPlan.approvedGraphRevision) {
    throw new Error(
      `Approved plan graph revision mismatch: expected ${parsedPlan.approvedGraphRevision}, got ${currentGraphRevision}.`,
    );
  }
  const approval = assertAgentApprovalGate({
    approval: parsedPlan.approval,
    expectedGraphRevision: parsedPlan.approvedGraphRevision,
    expectedRecipeHash: snapshot.initialPreview.recipeHash,
    expectedSessionId: parsedPlan.sessionId,
    operation: 'atomic apply',
    selectedImagePath: snapshot.activeImagePath,
  });

  const rollbackTarget = {
    adjustments: state.adjustments,
    graphRevision: currentGraphRevision,
    historyIndex: state.historyIndex,
    previewUrl: state.finalPreviewUrl,
  };

  const applied = await runAgentCoreEditCommandBundle({
    operationId: parsedPlan.operationId,
    sessionId: parsedPlan.sessionId,
    steps: parsedPlan.steps,
  });

  return {
    appliedGraphRevision: applied.appliedGraphRevision,
    approvalId: approval.approvalId,
    rollbackTarget,
  };
};

export const rollbackApprovedAgentPlan = (rollbackTarget: AgentAtomicApplyResult['rollbackTarget']): string => {
  useEditorStore.setState((state) => ({
    adjustments: rollbackTarget.adjustments,
    finalPreviewUrl: rollbackTarget.previewUrl,
    history: state.history.slice(0, rollbackTarget.historyIndex + 1),
    historyIndex: rollbackTarget.historyIndex,
    uncroppedAdjustedPreviewUrl: null,
  }));
  return rollbackTarget.graphRevision;
};
