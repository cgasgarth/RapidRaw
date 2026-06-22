import { z } from 'zod';

import { runAgentCoreEditCommandBundle, type AgentCoreEditCommandBundleStep } from './agentCoreEditCommandBundle';
import { useEditorStore } from '../store/useEditorStore';

import type { Adjustments } from './adjustments';

export interface AgentApprovedPlan {
  approvedAfterHash: string;
  approvedBeforeHash: string;
  approvedGraphRevision: string;
  approvalId: string;
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
    approvedAfterHash: z.string().trim().min(1),
    approvedBeforeHash: z.string().trim().min(1),
    approvedGraphRevision: z.string().trim().min(1),
    approvalId: z.string().trim().min(1),
    operationId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    steps: z.array(z.looseObject({ kind: z.enum(['basic_tone', 'selective_color']) })).min(1),
  })
  .strict();

export const applyApprovedAgentPlanAtomically = async (plan: AgentApprovedPlan): Promise<AgentAtomicApplyResult> => {
  approvedPlanSchema.parse(plan);
  const state = useEditorStore.getState();
  const currentGraphRevision = `history_${state.historyIndex}`;
  if (currentGraphRevision !== plan.approvedGraphRevision) {
    throw new Error(
      `Approved plan graph revision mismatch: expected ${plan.approvedGraphRevision}, got ${currentGraphRevision}.`,
    );
  }

  const rollbackTarget = {
    adjustments: state.adjustments,
    graphRevision: currentGraphRevision,
    historyIndex: state.historyIndex,
    previewUrl: state.finalPreviewUrl,
  };

  const applied = await runAgentCoreEditCommandBundle({
    operationId: plan.operationId,
    sessionId: plan.sessionId,
    steps: plan.steps,
  });

  return {
    appliedGraphRevision: applied.appliedGraphRevision,
    approvalId: plan.approvalId,
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
