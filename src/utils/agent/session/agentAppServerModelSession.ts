import { z } from 'zod';

export const AGENT_APP_SERVER_DEFAULT_MODEL_ID = 'gpt-5.6-terra';
export const AGENT_APP_SERVER_DEFAULT_REASONING_EFFORT = 'low';
export const AGENT_APP_SERVER_DEFAULT_MODEL_LABEL = 'GPT-5.6 Terra';

export const agentAppServerReasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']);

export const agentAppServerModelSelectionRequestSchema = z
  .object({
    modelId: z.string().trim().min(1).default(AGENT_APP_SERVER_DEFAULT_MODEL_ID),
    reasoningEffort: agentAppServerReasoningEffortSchema.default(AGENT_APP_SERVER_DEFAULT_REASONING_EFFORT),
  })
  .strict();

// Codex app-server `thread/start` uses `model` plus config.model_reasoning_effort.
export const agentAppServerThreadStartParamsSchema = z
  .object({
    config: z
      .object({
        model_reasoning_effort: agentAppServerReasoningEffortSchema,
      })
      .strict(),
    model: z.string().trim().min(1),
    serviceName: z.literal('rapidraw_selected_image_agent'),
  })
  .strict();

export const agentAppServerThreadStartResponseSchema = z
  .object({
    model: z.string().trim().min(1),
    modelProvider: z.string().trim().min(1),
    reasoningEffort: agentAppServerReasoningEffortSchema.nullable(),
    thread: z
      .object({
        id: z.string().trim().min(1),
      })
      .passthrough(),
  })
  .passthrough();

const agentAppServerRequestedModelSelectionSchema = z
  .object({
    modelId: z.string().trim().min(1),
    reasoningEffort: agentAppServerReasoningEffortSchema,
  })
  .strict();

const agentAppServerEffectiveModelSelectionSchema = agentAppServerRequestedModelSelectionSchema.extend({
  modelProvider: z.string().trim().min(1),
});

export const agentAppServerModelSelectionReceiptSchema = z.discriminatedUnion('status', [
  z
    .object({
      effective: agentAppServerEffectiveModelSelectionSchema,
      requested: agentAppServerRequestedModelSelectionSchema,
      status: z.enum(['accepted', 'fallback']),
      threadId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      effective: z.null(),
      reason: z.string().trim().min(1),
      requested: agentAppServerRequestedModelSelectionSchema,
      status: z.literal('rejected'),
    })
    .strict(),
]);

export type AgentAppServerModelSelectionReceipt = z.infer<typeof agentAppServerModelSelectionReceiptSchema>;
export type AgentAppServerModelSelectionRequest = z.infer<typeof agentAppServerModelSelectionRequestSchema>;
export type AgentAppServerThreadStartParams = z.infer<typeof agentAppServerThreadStartParamsSchema>;

export interface AgentAppServerSessionTransport {
  startThread: (params: AgentAppServerThreadStartParams) => Promise<unknown>;
}

export class AgentAppServerModelSelectionRejectedError extends Error {
  readonly receipt: Extract<AgentAppServerModelSelectionReceipt, { status: 'rejected' }>;

  constructor(receipt: Extract<AgentAppServerModelSelectionReceipt, { status: 'rejected' }>) {
    super(receipt.reason);
    this.name = 'AgentAppServerModelSelectionRejectedError';
    this.receipt = receipt;
  }
}

export const buildAgentAppServerThreadStartParams = (
  request: AgentAppServerModelSelectionRequest,
): AgentAppServerThreadStartParams => {
  const parsedRequest = agentAppServerModelSelectionRequestSchema.parse(request);
  return agentAppServerThreadStartParamsSchema.parse({
    config: { model_reasoning_effort: parsedRequest.reasoningEffort },
    model: parsedRequest.modelId,
    serviceName: 'rapidraw_selected_image_agent',
  });
};

const rejectedReceipt = ({
  reason,
  requested,
}: {
  reason: string;
  requested: AgentAppServerModelSelectionRequest;
}): Extract<AgentAppServerModelSelectionReceipt, { status: 'rejected' }> => {
  const receipt = agentAppServerModelSelectionReceiptSchema.parse({
    effective: null,
    reason,
    requested,
    status: 'rejected',
  });
  if (receipt.status !== 'rejected') throw new Error('Invalid rejected app-server model selection receipt.');
  return receipt;
};

export const startAgentAppServerModelSession = async ({
  request,
  transport,
}: {
  request: AgentAppServerModelSelectionRequest;
  transport: AgentAppServerSessionTransport | undefined;
}): Promise<Extract<AgentAppServerModelSelectionReceipt, { status: 'accepted' | 'fallback' }>> => {
  const requested = agentAppServerModelSelectionRequestSchema.parse(request);
  if (transport === undefined) {
    throw new AgentAppServerModelSelectionRejectedError(
      rejectedReceipt({ reason: 'Codex app-server thread/start transport is unavailable.', requested }),
    );
  }

  let rawResponse: unknown;
  try {
    rawResponse = await transport.startThread(buildAgentAppServerThreadStartParams(requested));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : 'Codex app-server thread/start failed.';
    throw new AgentAppServerModelSelectionRejectedError(rejectedReceipt({ reason: message, requested }));
  }

  let response: z.infer<typeof agentAppServerThreadStartResponseSchema>;
  try {
    response = agentAppServerThreadStartResponseSchema.parse(rawResponse);
  } catch {
    throw new AgentAppServerModelSelectionRejectedError(
      rejectedReceipt({ reason: 'Codex app-server thread/start returned an invalid model receipt.', requested }),
    );
  }
  if (response.reasoningEffort === null) {
    throw new AgentAppServerModelSelectionRejectedError(
      rejectedReceipt({ reason: 'Codex app-server did not report an effective reasoning effort.', requested }),
    );
  }

  const receipt = agentAppServerModelSelectionReceiptSchema.parse({
    effective: {
      modelId: response.model,
      modelProvider: response.modelProvider,
      reasoningEffort: response.reasoningEffort,
    },
    requested,
    status:
      response.model === requested.modelId && response.reasoningEffort === requested.reasoningEffort
        ? 'accepted'
        : 'fallback',
    threadId: response.thread.id,
  });
  if (receipt.status === 'rejected') throw new Error('Invalid accepted app-server model selection receipt.');
  return receipt;
};
