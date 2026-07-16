import {
  type AgentSelectedImageLifecycleReceiptV2,
  hashAgentSelectedImageLifecycleValue,
  sealAgentSelectedImageLifecyclePhase,
} from '../../../../src/schemas/agent/agentSelectedImageLifecycleReceiptSchemas';
import type { AgentSelectedImageProposalLineageV1 } from '../../../../src/schemas/agent/agentSelectedImageProposalIterationSchemas';

export const buildCurrentSelectedImageEvidence = async ({
  afterPreviewHash,
  afterRecipeHash,
  beforePreviewHash,
  beforeRecipeHash,
  graphRevision,
  sessionId,
}: {
  afterPreviewHash: string;
  afterRecipeHash: string;
  beforePreviewHash: string;
  beforeRecipeHash: string;
  graphRevision: string;
  sessionId: string;
}): Promise<{
  lifecycleReceipt: AgentSelectedImageLifecycleReceiptV2;
  proposalLineage: AgentSelectedImageProposalLineageV1;
}> => {
  const createdAt = '2026-07-16T00:00:00.000Z';
  const proposalId = `${sessionId}-proposal`;
  const proposalHash = await hashAgentSelectedImageLifecycleValue('proposal-identity', { proposalId, sessionId });
  const receiptHash = await hashAgentSelectedImageLifecycleValue('proposal-render-receipt', { sessionId });
  const proposal = await sealAgentSelectedImageLifecyclePhase('proposal', {
    afterArtifactHash: await hashAgentSelectedImageLifecycleValue('after-artifact', { afterPreviewHash }),
    beforeArtifactHash: await hashAgentSelectedImageLifecycleValue('before-artifact', { beforePreviewHash }),
    editGraph: { graphRevision },
    graphRevision,
    lineage: {
      epoch: 3,
      iterationId: `${sessionId}-iteration-1`,
      lineageId: `${sessionId}-lineage`,
      ordinal: 1,
      proposalHash,
      proposalId,
      state: 'sealed' as const,
    },
    proposalHash,
    proposalId,
    receiptHash,
    recipeHash: beforeRecipeHash,
    renderSpecHash: await hashAgentSelectedImageLifecycleValue('render-spec', { sessionId }),
    selectedImageId: await hashAgentSelectedImageLifecycleValue('selected-image', { sessionId }),
  });
  const approval = await sealAgentSelectedImageLifecyclePhase('approval', {
    actor: 'user',
    approvalId: `${sessionId}-approval`,
    approvedAt: createdAt,
    policyVersion: 'selected-image-current-v2',
    proposalHash,
    proposalId,
    receiptHash,
    source: 'user' as const,
  });
  const commit = await sealAgentSelectedImageLifecyclePhase('commit', {
    afterGraphHash: await hashAgentSelectedImageLifecycleValue('after-graph', { graphRevision: 'history_1' }),
    afterPreviewHash: await hashAgentSelectedImageLifecycleValue('after-preview', { afterPreviewHash }),
    afterRecipeHash: await hashAgentSelectedImageLifecycleValue('after-recipe', { afterRecipeHash }),
    beforeGraphHash: await hashAgentSelectedImageLifecycleValue('before-graph', { graphRevision }),
    beforePreviewHash: await hashAgentSelectedImageLifecycleValue('before-preview', { beforePreviewHash }),
    beforeRecipeHash: await hashAgentSelectedImageLifecycleValue('before-recipe', { beforeRecipeHash }),
    history: { afterDepth: 2, beforeDepth: 1, transactionId: `${sessionId}-transaction` },
    parity: { mode: 'decoded_pixel' as const, result: 'passed' as const, threshold: 0 },
    status: 'applied' as const,
    toolCalls: [{ id: `${sessionId}-apply`, name: 'rawengine.agent.adjustments.apply' }],
    transactionId: `${sessionId}-transaction`,
  });
  const lifecycleReceipt = await sealAgentSelectedImageLifecyclePhase('receipt', {
    approval,
    commit,
    createdAt,
    proposal,
    schemaVersion: 2 as const,
    sessionId,
  });
  const iterationId = `${sessionId}-iteration-1`;
  return {
    lifecycleReceipt,
    proposalLineage: {
      epoch: 3,
      iterations: [
        {
          baseGraphRevision: graphRevision,
          basePreviewArtifactId: `${sessionId}-before-preview`,
          basePreviewContentHash: proposal.beforeArtifactHash,
          baseRecipeHash: beforeRecipeHash,
          beforePreviewArtifactId: `${sessionId}-before-preview`,
          beforePreviewContentHash: proposal.beforeArtifactHash,
          cleanupStatus: 'retained_for_apply',
          createdAt,
          expiresAt: '2026-07-16T00:05:00.000Z',
          initiatingTurnId: `${sessionId}-turn-1`,
          iterationId,
          lineageId: `${sessionId}-lineage`,
          ordinal: 1,
          proposalHash,
          proposalId,
          proposalSchemaVersion: 1,
          schemaVersion: 1,
          selectedImageId: proposal.selectedImageId,
          sessionId,
          state: 'applied',
          toolCalls: [{ callId: `${sessionId}-proposal-render`, type: 'proposal_render' }],
        },
      ],
      lineageId: `${sessionId}-lineage`,
      schemaVersion: 1,
      sessionId,
    },
  };
};
