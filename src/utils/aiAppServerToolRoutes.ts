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
      deferredIssue: '#1276',
      reason: 'Depth mask generation needs a dedicated AI mask capability and command payload before app-server apply.',
      status: 'deferred',
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
      deferredIssue: '#1276',
      reason: 'Generative inpaint currently uses the legacy connector request and needs dry-run/apply plan wiring.',
      status: 'deferred',
      tauriInvoke: 'invoke_generative_replace',
      toolCapability: 'inpaint',
    },
    {
      deferredIssue: '#1276',
      reason: 'Mask-definition generative inpaint shares the legacy connector path until app-server plan wiring lands.',
      status: 'deferred',
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
