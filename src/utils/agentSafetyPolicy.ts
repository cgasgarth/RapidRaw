import { z } from 'zod';

export const agentSafetyOperationKindSchema = z.enum([
  'ambiguous_subject_edit',
  'export_write',
  'global_adjustment',
  'retouch_remove',
  'rollback',
]);

export const agentSafetyPolicyDecisionSchema = z
  .object({
    approvalRequired: z.boolean(),
    blocked: z.boolean(),
    decisionId: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    severity: z.enum(['allow', 'block', 'review']),
  })
  .strict();

export const agentSafetyPolicyRequestSchema = z
  .object({
    operationKind: agentSafetyOperationKindSchema,
    prompt: z.string().trim().min(1),
    radiusPx: z.number().positive().max(4096).optional(),
    rollbackScope: z.enum(['operation', 'session_start']).optional(),
  })
  .strict();

export type AgentSafetyPolicyDecision = z.infer<typeof agentSafetyPolicyDecisionSchema>;
export type AgentSafetyPolicyRequest = z.infer<typeof agentSafetyPolicyRequestSchema>;

const LARGE_RETOUCH_RADIUS_PX = 96;
const ambiguousSubjectTerms = ['person', 'subject', 'face', 'skin', 'sky', 'background'] as const;

const decision = (
  decisionId: string,
  severity: AgentSafetyPolicyDecision['severity'],
  reason: string,
): AgentSafetyPolicyDecision =>
  agentSafetyPolicyDecisionSchema.parse({
    approvalRequired: severity === 'review',
    blocked: severity === 'block',
    decisionId,
    reason,
    severity,
  });

const promptHasAmbiguousSubject = (prompt: string): boolean => {
  const normalizedPrompt = prompt.toLocaleLowerCase('en-US');
  return ambiguousSubjectTerms.some((term) => normalizedPrompt.includes(term));
};

export const inferAgentSafetyOperationKind = (prompt: string): AgentSafetyPolicyRequest['operationKind'] => {
  const normalizedPrompt = prompt.toLocaleLowerCase('en-US');
  if (/\b(export|save|write|overwrite|file)\b/u.test(normalizedPrompt)) return 'export_write';
  if (/\b(rollback|undo|discard|reset)\b/u.test(normalizedPrompt)) return 'rollback';
  if (/\b(remove|erase|inpaint|delete object|clean up)\b/u.test(normalizedPrompt)) return 'retouch_remove';
  if (promptHasAmbiguousSubject(normalizedPrompt)) return 'ambiguous_subject_edit';
  return 'global_adjustment';
};

export const evaluateAgentSafetyPolicy = (request: AgentSafetyPolicyRequest): AgentSafetyPolicyDecision => {
  const parsedRequest = agentSafetyPolicyRequestSchema.parse(request);

  if (parsedRequest.operationKind === 'export_write') {
    return decision(
      'agent_policy_export_write_confirmation',
      'review',
      'Export and file writes require user approval.',
    );
  }

  if (parsedRequest.operationKind === 'rollback') {
    return parsedRequest.rollbackScope === 'session_start'
      ? decision('agent_policy_session_rollback_confirmation', 'review', 'Session rollback requires user approval.')
      : decision('agent_policy_operation_rollback_allowed', 'allow', 'Operation rollback can use existing undo state.');
  }

  if (parsedRequest.operationKind === 'retouch_remove') {
    if ((parsedRequest.radiusPx ?? 0) > LARGE_RETOUCH_RADIUS_PX) {
      return decision('agent_policy_large_retouch_blocked', 'block', 'Large retouch remove operations are blocked.');
    }
    return decision('agent_policy_retouch_remove_confirmation', 'review', 'Retouch remove requires user approval.');
  }

  if (parsedRequest.operationKind === 'ambiguous_subject_edit') {
    return decision('agent_policy_ambiguous_subject_confirmation', 'review', 'Ambiguous subject edits require review.');
  }

  return decision(
    'agent_policy_small_global_adjustment_allowed',
    'allow',
    'Small global tone edits can run after dry-run.',
  );
};
