import { aiAppServerToolRouteManifestSchema, type AiAppServerToolRoute } from '../schemas/aiAppServerToolRouteSchemas';

export const AI_APP_SERVER_TOOL_ROUTE_MANIFEST = aiAppServerToolRouteManifestSchema.parse({
  routes: [
    {
      appServerToolName: 'ai.mask.dry_run_subject',
      commandSchemaName: 'AiToolCommandEnvelopeV1',
      reason: 'Subject-mask generation is represented by the typed AI mask dry-run tool.',
      status: 'mapped',
      tauriInvoke: 'generate_ai_subject_mask',
      toolCapability: 'subject_mask',
    },
    {
      appServerToolName: 'ai.mask.dry_run_subject',
      commandSchemaName: 'AiToolCommandEnvelopeV1',
      reason: 'Subject-mask precompute feeds the same dry-run tool surface before UI apply.',
      status: 'mapped',
      tauriInvoke: 'precompute_ai_subject_mask',
      toolCapability: 'subject_mask',
    },
    {
      appServerToolName: 'ai.mask.dry_run_subject',
      commandSchemaName: 'AiToolCommandEnvelopeV1',
      reason: 'Depth mask generation is supported by the typed AI mask dry-run tool capability set.',
      status: 'mapped',
      tauriInvoke: 'generate_ai_depth_mask',
      toolCapability: 'depth_mask',
    },
    {
      appServerToolName: 'ai.mask.dry_run_subject',
      commandSchemaName: 'AiToolCommandEnvelopeV1',
      reason: 'Foreground mask generation is supported by the typed AI mask dry-run tool capability set.',
      status: 'mapped',
      tauriInvoke: 'generate_ai_foreground_mask',
      toolCapability: 'foreground_mask',
    },
    {
      appServerToolName: 'ai.mask.dry_run_subject',
      commandSchemaName: 'AiToolCommandEnvelopeV1',
      reason: 'Sky mask generation is supported by the typed AI mask dry-run tool capability set.',
      status: 'mapped',
      tauriInvoke: 'generate_ai_sky_mask',
      toolCapability: 'sky_mask',
    },
    {
      appServerToolName: 'ai.enhancement.dry_run_command',
      commandSchemaName: 'AiEnhancementCommandEnvelopeV1',
      reason: 'Generative inpaint preview maps to the typed AI enhancement dry-run tool before apply approval.',
      status: 'mapped',
      tauriInvoke: 'invoke_generative_replace',
      toolCapability: 'inpaint',
    },
    {
      appServerToolName: 'ai.enhancement.apply_command',
      commandSchemaName: 'AiEnhancementCommandEnvelopeV1',
      reason:
        'Mask-definition generative inpaint mutates the edit graph and maps to the typed enhancement apply tool; dry-run parity remains tracked separately.',
      status: 'mapped',
      tauriInvoke: 'invoke_generative_replace_with_mask_def',
      toolCapability: 'inpaint',
    },
    {
      reason: 'Connector health is a capability/status probe, not an image edit tool call.',
      status: 'connector_status',
      tauriInvoke: 'check_ai_connector_status',
    },
    {
      reason: 'Connector test is a settings validation probe, not an image edit tool call.',
      status: 'connector_status',
      tauriInvoke: 'test_ai_connector_connection',
    },
    {
      reason: 'AI tag cleanup mutates library metadata and is tracked outside image-edit app-server tools.',
      status: 'metadata_cleanup',
      tauriInvoke: 'clear_ai_tags',
    },
  ],
  schemaVersion: 1,
});

export const AI_APP_SERVER_TOOL_ROUTES: ReadonlyArray<AiAppServerToolRoute> = AI_APP_SERVER_TOOL_ROUTE_MANIFEST.routes;
