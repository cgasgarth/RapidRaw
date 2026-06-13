import { z } from 'zod';

export const AiProviderId = {
  Cloud: 'cloud',
  Connector: 'ai-connector',
  Local: 'cpu',
} as const;

export const aiProviderIdSchema = z.enum([AiProviderId.Local, AiProviderId.Connector, AiProviderId.Cloud]);

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = AiProviderId.Local;

export const aiProviderSettingsSchema = z
  .object({
    aiConnectorAddress: z.string().trim().min(1).optional(),
    aiProvider: z.preprocess((value) => normalizeAiProviderId(value), aiProviderIdSchema),
  })
  .loose();

export type AiProviderSettings = z.infer<typeof aiProviderSettingsSchema>;

export const normalizeAiProviderId = (value: unknown): AiProviderId => {
  const parsed = aiProviderIdSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  return DEFAULT_AI_PROVIDER_ID;
};
