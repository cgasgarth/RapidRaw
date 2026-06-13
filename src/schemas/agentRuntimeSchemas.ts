import { z } from 'zod';

export const AgentRuntimeId = {
  AppServer: 'app-server',
} as const;

export const agentRuntimeIdSchema = z.enum([AgentRuntimeId.AppServer]);

export type AgentRuntimeId = z.infer<typeof agentRuntimeIdSchema>;

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeId = AgentRuntimeId.AppServer;

export const agentRuntimeSettingsSchema = z
  .object({
    agentRuntime: agentRuntimeIdSchema.default(DEFAULT_AGENT_RUNTIME_ID),
    enabled: z.boolean().default(false),
  })
  .strict();

export type AgentRuntimeSettings = z.infer<typeof agentRuntimeSettingsSchema>;

export const normalizeAgentRuntimeId = (value: unknown): AgentRuntimeId => {
  const parsed = agentRuntimeIdSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AGENT_RUNTIME_ID;
};
