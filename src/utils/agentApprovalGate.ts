import { z } from 'zod';

export const agentApprovalStatusSchema = z.enum(['approved', 'cancelled', 'pending']);

export const agentApprovalStateSchema = z
  .object({
    approvalId: z.string().trim().min(1),
    approvedGraphRevision: z.string().trim().min(1),
    approvedRecipeHash: z.string().trim().min(1),
    approvedSelectedImagePath: z.string().trim().min(1),
    approvedSessionId: z.string().trim().min(1),
    status: agentApprovalStatusSchema,
  })
  .strict();

export type AgentApprovalState = z.infer<typeof agentApprovalStateSchema>;

export type AgentApprovalGateExpectation = {
  approval: AgentApprovalState;
  expectedGraphRevision: string;
  expectedRecipeHash: string;
  expectedSessionId: string;
  operation: string;
  selectedImagePath: string;
};

export const assertAgentApprovalGate = (expectation: AgentApprovalGateExpectation): AgentApprovalState => {
  const approval = agentApprovalStateSchema.parse(expectation.approval);
  if (approval.status !== 'approved') {
    throw new Error(`Agent ${expectation.operation} requires approved backend approval state.`);
  }
  if (approval.approvedSessionId !== expectation.expectedSessionId) {
    throw new Error(`Agent ${expectation.operation} rejected approval from a different session.`);
  }
  if (approval.approvedGraphRevision !== expectation.expectedGraphRevision) {
    throw new Error(`Agent ${expectation.operation} rejected stale graph approval.`);
  }
  if (approval.approvedRecipeHash !== expectation.expectedRecipeHash) {
    throw new Error(`Agent ${expectation.operation} rejected stale recipe approval.`);
  }
  if (approval.approvedSelectedImagePath !== expectation.selectedImagePath) {
    throw new Error(`Agent ${expectation.operation} rejected approval for a different selected image.`);
  }
  return approval;
};
