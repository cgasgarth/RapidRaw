import { z } from 'zod';

export const AiProviderId = {
  AppServer: 'app-server',
  Cloud: 'cloud',
  Connector: 'ai-connector',
  Local: 'cpu',
} as const;

export const aiProviderIdSchema = z.enum([
  AiProviderId.Local,
  AiProviderId.Connector,
  AiProviderId.Cloud,
  AiProviderId.AppServer,
]);

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = AiProviderId.Local;

export const aiProviderSettingsSchema = z
  .object({
    aiConnectorAddress: z.string().trim().min(1).optional(),
    aiProvider: aiProviderIdSchema.default(DEFAULT_AI_PROVIDER_ID),
  })
  .loose();

export type AiProviderSettings = z.infer<typeof aiProviderSettingsSchema>;

export const normalizeAiProviderId = (value: unknown): AiProviderId => {
  const parsed = aiProviderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_AI_PROVIDER_ID;
};
