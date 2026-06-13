import { z } from 'zod';

export const AiProviderId = {
  Cloud: 'cloud',
  Connector: 'ai-connector',
  Local: 'cpu',
} as const;

export const aiProviderIdSchema = z.enum([AiProviderId.Local, AiProviderId.Connector, AiProviderId.Cloud]);

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = AiProviderId.Local;

export const AiProviderFallbackReason = {
  CloudPlanRequired: 'cloud_plan_required',
  CloudSignedOut: 'cloud_signed_out',
  ConnectorUnavailable: 'connector_unavailable',
  InvalidProvider: 'invalid_provider',
} as const;

export const aiProviderFallbackReasonSchema = z.enum([
  AiProviderFallbackReason.CloudPlanRequired,
  AiProviderFallbackReason.CloudSignedOut,
  AiProviderFallbackReason.ConnectorUnavailable,
  AiProviderFallbackReason.InvalidProvider,
]);

export type AiProviderFallbackReason = z.infer<typeof aiProviderFallbackReasonSchema>;

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

export const aiProviderRuntimeInputSchema = z
  .object({
    aiProvider: z.unknown().optional(),
    isAIConnectorConnected: z.boolean().default(false),
    isPro: z.boolean().default(false),
    isSignedIn: z.boolean().default(false),
  })
  .strict();

export const aiProviderRuntimeStateSchema = z
  .object({
    effectiveProvider: aiProviderIdSchema,
    fallbackApplied: z.boolean(),
    fallbackReason: aiProviderFallbackReasonSchema.nullable(),
    generativeEditAvailable: z.boolean(),
    requestedProvider: aiProviderIdSchema,
    requestedProviderAvailable: z.boolean(),
  })
  .strict();

export type AiProviderRuntimeInput = z.input<typeof aiProviderRuntimeInputSchema>;
export type AiProviderRuntimeState = z.infer<typeof aiProviderRuntimeStateSchema>;

export const resolveAiProviderRuntimeState = (value: AiProviderRuntimeInput): AiProviderRuntimeState => {
  const input = aiProviderRuntimeInputSchema.parse(value);
  const requestedProviderResult = aiProviderIdSchema.safeParse(input.aiProvider);

  if (!requestedProviderResult.success) {
    return aiProviderRuntimeStateSchema.parse({
      effectiveProvider: AiProviderId.Local,
      fallbackApplied: true,
      fallbackReason: AiProviderFallbackReason.InvalidProvider,
      generativeEditAvailable: false,
      requestedProvider: DEFAULT_AI_PROVIDER_ID,
      requestedProviderAvailable: false,
    });
  }

  const requestedProvider = requestedProviderResult.data;

  if (requestedProvider === AiProviderId.Connector) {
    return aiProviderRuntimeStateSchema.parse({
      effectiveProvider: input.isAIConnectorConnected ? AiProviderId.Connector : AiProviderId.Local,
      fallbackApplied: !input.isAIConnectorConnected,
      fallbackReason: input.isAIConnectorConnected ? null : AiProviderFallbackReason.ConnectorUnavailable,
      generativeEditAvailable: input.isAIConnectorConnected,
      requestedProvider,
      requestedProviderAvailable: input.isAIConnectorConnected,
    });
  }

  if (requestedProvider === AiProviderId.Cloud) {
    const requestedProviderAvailable = input.isSignedIn && input.isPro;
    const fallbackReason = !input.isSignedIn
      ? AiProviderFallbackReason.CloudSignedOut
      : input.isPro
        ? null
        : AiProviderFallbackReason.CloudPlanRequired;

    return aiProviderRuntimeStateSchema.parse({
      effectiveProvider: requestedProviderAvailable ? AiProviderId.Cloud : AiProviderId.Local,
      fallbackApplied: !requestedProviderAvailable,
      fallbackReason,
      generativeEditAvailable: requestedProviderAvailable,
      requestedProvider,
      requestedProviderAvailable,
    });
  }

  return aiProviderRuntimeStateSchema.parse({
    effectiveProvider: AiProviderId.Local,
    fallbackApplied: false,
    fallbackReason: null,
    generativeEditAvailable: false,
    requestedProvider,
    requestedProviderAvailable: true,
  });
};
