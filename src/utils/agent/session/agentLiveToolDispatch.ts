import { z } from 'zod';
import {
  RawEngineAppServerHostToolName,
  type RawEngineAppServerToolDispatchRequest,
} from '../../../schemas/agent/agentRuntimeSchemas';
import { handleRawEngineAppServerHostRequestAsync } from '../../rawEngineAppServerHost';
import {
  AGENT_EXPORT_PROOF_TOOL_NAME,
  AGENT_FINAL_EXPORT_TOOL_NAME,
  type AgentExportProofRequest,
  type AgentExportProofResponse,
  type AgentFinalExportRequest,
  type AgentFinalExportResponse,
  agentExportProofResponseSchema,
  agentFinalExportResponseSchema,
} from '../safety/agentExportProofTool';

const agentLiveToolDispatchResultSchema = z.looseObject({
  dispatchStatus: z.enum(['completed']),
  result: z.unknown(),
  runtimeToolName: z.string().trim().min(1),
});

export const dispatchAgentLiveEditorTool = async ({
  args,
  draftSession,
  requestId,
  runtimeToolName,
}: {
  args: unknown;
  draftSession?: RawEngineAppServerToolDispatchRequest['draftSession'];
  requestId: string;
  runtimeToolName: string;
}): Promise<unknown> => {
  const response = agentLiveToolDispatchResultSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      draftSession,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );
  return response.result;
};

export const dispatchAgentExportReviewTool = async ({
  request,
  requestId,
}: {
  request: AgentExportProofRequest;
  requestId: string;
}): Promise<AgentExportProofResponse> =>
  agentExportProofResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: request,
      requestId,
      runtimeToolName: AGENT_EXPORT_PROOF_TOOL_NAME,
    }),
  );

export const dispatchAgentFinalExportTool = async ({
  request,
  requestId,
}: {
  request: AgentFinalExportRequest;
  requestId: string;
}): Promise<AgentFinalExportResponse> =>
  agentFinalExportResponseSchema.parse(
    await dispatchAgentLiveEditorTool({
      args: request,
      requestId,
      runtimeToolName: AGENT_FINAL_EXPORT_TOOL_NAME,
    }),
  );
