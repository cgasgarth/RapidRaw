import { z } from 'zod';

import {
  RawEngineAppServerHostToolName,
  type RawEngineAppServerToolDispatchRequest,
  rawEngineAppServerToolDispatchResponseSchema,
} from '../../../schemas/agent/agentRuntimeSchemas';
import {
  cancelRawEngineAppServerTypedDispatch,
  handleRawEngineAppServerHostRequestAsync,
  registerRawEngineAppServerTypedDispatchResultCleanup,
} from '../../rawEngineAppServerHost';
import {
  type AgentEditorToolName,
  type AgentEditorToolRequest,
  type AgentEditorToolResponse,
  agentEditorToolContracts,
} from './agentTypedToolContracts';

const dispatchIdentitySchema = z
  .object({
    expectedGraphRevision: z.string().trim().min(1).optional(),
    expectedRecipeHash: z.string().trim().min(1).optional(),
    expectedCurrentGraphRevision: z.string().trim().min(1).optional(),
    expectedCurrentPreviewRecipeHash: z.string().trim().min(1).optional(),
    expectedSelectedImagePath: z.string().trim().min(1).optional(),
    selectedImagePath: z.string().trim().min(1).optional(),
    sessionId: z.string().trim().min(1).optional(),
  })
  .passthrough();

const typedExecutionContextSchema = z
  .object({
    callId: z.string().trim().min(1),
    cancellationId: z.string().trim().min(1),
    deadlineAt: z.iso.datetime(),
    expected: z
      .object({
        graphRevision: z.string().trim().min(1).optional(),
        recipeHash: z.string().trim().min(1).optional(),
        selectedImagePath: z.string().trim().min(1).optional(),
      })
      .strict()
      .optional(),
    idempotencyKey: z.string().trim().min(1),
    iterationId: z.string().trim().min(1).optional(),
    parentCallId: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export type AgentTypedToolExecutionContext = z.infer<typeof typedExecutionContextSchema>;

export const createAgentTypedToolExecutionContext = ({
  arguments: args,
  callId,
  deadlineMs = 15_000,
  iterationId,
  parentCallId,
  requestId,
  sessionId,
}: {
  arguments: unknown;
  callId?: string;
  deadlineMs?: number;
  iterationId?: string;
  parentCallId?: string;
  requestId: string;
  sessionId?: string;
}): AgentTypedToolExecutionContext => {
  const identity = dispatchIdentitySchema.parse(args);
  const resolvedCallId = callId ?? requestId;
  const resolvedSessionId = sessionId ?? identity.sessionId ?? `agent-session-${requestId}`;
  const graphRevision = identity.expectedGraphRevision ?? identity.expectedCurrentGraphRevision;
  const recipeHash = identity.expectedRecipeHash ?? identity.expectedCurrentPreviewRecipeHash;
  const selectedImagePath = identity.selectedImagePath ?? identity.expectedSelectedImagePath;
  return typedExecutionContextSchema.parse({
    callId: resolvedCallId,
    cancellationId: `cancel-${resolvedCallId}`,
    deadlineAt: new Date(Date.now() + deadlineMs).toISOString(),
    expected:
      graphRevision === undefined && recipeHash === undefined && selectedImagePath === undefined
        ? undefined
        : {
            ...(graphRevision === undefined ? {} : { graphRevision }),
            ...(recipeHash === undefined ? {} : { recipeHash }),
            ...(selectedImagePath === undefined ? {} : { selectedImagePath }),
          },
    idempotencyKey: `idem-${resolvedCallId}`,
    ...(iterationId === undefined ? {} : { iterationId }),
    ...(parentCallId === undefined ? {} : { parentCallId }),
    requestId,
    sessionId: resolvedSessionId,
  });
};

type TypedDispatchInput<Name extends AgentEditorToolName> = {
  args: AgentEditorToolRequest<Name>;
  cleanupResult?: (result: AgentEditorToolResponse<Name>) => void;
  context: AgentTypedToolExecutionContext;
  draftSession?: RawEngineAppServerToolDispatchRequest['draftSession'];
  signal?: AbortSignal;
  toolName: Name;
};

export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.state.get'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.state.get'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.image.get_preview'>,
): Promise<AgentEditorToolResponse<'rawengine.image.get_preview'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.preview.render'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.preview.render'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.preview.compare'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.preview.compare'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.adjustments.dry_run'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.adjustments.dry_run'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.adjustments.apply'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.adjustments.apply'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.history.rollback'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.history.rollback'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.selected_image.preview_loop'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.selected_image.preview_loop'>>;
export function dispatchAgentTypedEditorTool(
  input: TypedDispatchInput<'rawengine.agent.selected_image.preview_loop.apply_review'>,
): Promise<AgentEditorToolResponse<'rawengine.agent.selected_image.preview_loop.apply_review'>>;
export async function dispatchAgentTypedEditorTool({
  args,
  cleanupResult,
  context,
  draftSession,
  signal,
  toolName,
}: TypedDispatchInput<AgentEditorToolName>): Promise<AgentEditorToolResponse<AgentEditorToolName>> {
  const contract = agentEditorToolContracts[toolName];
  const parsedArgs = contract.requestSchema.parse(args);
  const parsedContext = typedExecutionContextSchema.parse(context);
  if (signal?.aborted) cancelRawEngineAppServerTypedDispatch(parsedContext.cancellationId);
  const abort = () => cancelRawEngineAppServerTypedDispatch(parsedContext.cancellationId);
  const unregisterCleanup =
    cleanupResult === undefined
      ? undefined
      : registerRawEngineAppServerTypedDispatchResultCleanup(parsedContext.cancellationId, (result) => {
          const parsedResult = contract.responseSchema.safeParse(result);
          if (parsedResult.success) cleanupResult(parsedResult.data);
        });
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = rawEngineAppServerToolDispatchResponseSchema.parse(
      await handleRawEngineAppServerHostRequestAsync({
        arguments: parsedArgs,
        draftSession,
        executionContext: parsedContext,
        requestId: parsedContext.requestId,
        runtimeToolName: toolName,
        toolName: RawEngineAppServerHostToolName.DispatchTool,
      }),
    );
    if (response.dispatchStatus !== 'completed' || response.result === undefined) {
      throw new Error(response.message ?? `Typed dispatch rejected ${toolName}.`);
    }
    const result = contract.responseSchema.parse(response.result);
    if (response.execution?.outcome !== 'completed') {
      throw new Error(`Typed dispatch did not complete ${toolName}.`);
    }
    return result;
  } finally {
    unregisterCleanup?.();
    signal?.removeEventListener('abort', abort);
  }
}
