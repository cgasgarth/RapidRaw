import { z } from 'zod';
import { RawEngineAppServerHostToolName } from '../schemas/agentRuntimeSchemas';
import { handleRawEngineAppServerHostRequestAsync } from './rawEngineAppServerHost';

const agentLiveToolDispatchResultSchema = z.looseObject({
  dispatchStatus: z.enum(['completed']),
  result: z.unknown(),
  runtimeToolName: z.string().trim().min(1),
});

export const dispatchAgentLiveEditorTool = async ({
  args,
  requestId,
  runtimeToolName,
}: {
  args: unknown;
  requestId: string;
  runtimeToolName: string;
}): Promise<unknown> => {
  const response = agentLiveToolDispatchResultSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );
  return response.result;
};
