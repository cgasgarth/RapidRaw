import {
  AiAppServerToolCapability,
  AiAppServerToolName,
  AiAppServerToolRouteExecutionMode,
  AiAppServerToolRouteSourceKind,
  AiAppServerToolRouteStatus,
  AiAppServerToolSchemaName,
} from './aiAppServerToolRouteIds';
import { aiAppServerToolRouteManifestSchema, type AiAppServerToolRoute } from '../schemas/aiAppServerToolRouteSchemas';

const mappedTauriInvoke = {
  sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
  status: AiAppServerToolRouteStatus.Mapped,
} as const;
const mappedAppServerTool = {
  sourceKind: AiAppServerToolRouteSourceKind.AppServerTool,
  status: AiAppServerToolRouteStatus.Mapped,
} as const;
const aiMaskDryRun = {
  appServerToolName: AiAppServerToolName.MaskDryRunSubject,
  commandSchemaName: AiAppServerToolSchemaName.ToolCommandEnvelope,
  executionMode: AiAppServerToolRouteExecutionMode.DryRunCommand,
  outputSchemaName: AiAppServerToolSchemaName.ToolDryRunResult,
} as const;
const aiEnhancementDryRun = {
  appServerToolName: AiAppServerToolName.EnhancementDryRunCommand,
  commandSchemaName: AiAppServerToolSchemaName.EnhancementCommandEnvelope,
  executionMode: AiAppServerToolRouteExecutionMode.DryRunCommand,
  outputSchemaName: AiAppServerToolSchemaName.EnhancementDryRunResult,
} as const;
const aiEnhancementApply = {
  appServerToolName: AiAppServerToolName.EnhancementApplyCommand,
  commandSchemaName: AiAppServerToolSchemaName.EnhancementCommandEnvelope,
  executionMode: AiAppServerToolRouteExecutionMode.ApplyDryRunPlan,
  outputSchemaName: AiAppServerToolSchemaName.EnhancementApplyResult,
} as const;

export const AI_APP_SERVER_TOOL_ROUTE_MANIFEST = aiAppServerToolRouteManifestSchema.parse({
  routes: [
    {
      ...aiMaskDryRun,
      reason: 'Subject-mask generation is represented by the typed AI mask dry-run tool.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_subject_mask',
      toolCapability: AiAppServerToolCapability.SubjectMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Subject-mask precompute feeds the same dry-run tool surface before UI apply.',
      ...mappedTauriInvoke,
      sourceOperation: 'precompute_ai_subject_mask',
      toolCapability: AiAppServerToolCapability.SubjectMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Depth mask generation is supported by the typed AI mask dry-run tool capability set.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_depth_mask',
      toolCapability: AiAppServerToolCapability.DepthMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Foreground mask generation is supported by the typed AI mask dry-run tool capability set.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_foreground_mask',
      toolCapability: AiAppServerToolCapability.ForegroundMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Whole-person mask generation is supported by the typed AI mask dry-run tool capability set.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_whole_person_mask',
      toolCapability: AiAppServerToolCapability.PersonMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Person-part mask generation maps face/full-person targets onto the typed person-mask tool surface.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_person_part_mask',
      toolCapability: AiAppServerToolCapability.PersonMask,
    },
    {
      ...aiMaskDryRun,
      reason: 'Sky mask generation is supported by the typed AI mask dry-run tool capability set.',
      ...mappedTauriInvoke,
      sourceOperation: 'generate_ai_sky_mask',
      toolCapability: AiAppServerToolCapability.SkyMask,
    },
    {
      appServerToolName: AiAppServerToolName.MaskApplySubject,
      commandSchemaName: AiAppServerToolSchemaName.ToolCommandEnvelope,
      executionMode: AiAppServerToolRouteExecutionMode.ApplyDryRunPlan,
      outputSchemaName: AiAppServerToolSchemaName.ToolApplyResult,
      reason: 'Accepted AI mask dry-run plans apply through the typed app-server tool surface.',
      ...mappedAppServerTool,
      sourceOperation: AiAppServerToolName.MaskApplySubject,
      toolCapability: AiAppServerToolCapability.SubjectMask,
    },
    {
      ...aiEnhancementDryRun,
      reason:
        'Generative inpaint preview maps directly to the typed AI enhancement dry-run tool because the legacy Tauri preview invoke is no longer registered.',
      ...mappedAppServerTool,
      sourceOperation: AiAppServerToolName.EnhancementDryRunCommand,
      toolCapability: AiAppServerToolCapability.Inpaint,
    },
    {
      ...aiEnhancementApply,
      reason:
        'Mask-definition generative inpaint mutates the edit graph and maps to the typed enhancement apply tool; dry-run parity remains tracked separately.',
      ...mappedTauriInvoke,
      sourceOperation: 'invoke_generative_replace_with_mask_def',
      toolCapability: AiAppServerToolCapability.Inpaint,
    },
    {
      ...aiEnhancementDryRun,
      reason: 'Local AI denoise exposes a typed dry-run tool before an accepted denoise apply plan can mutate state.',
      ...mappedAppServerTool,
      sourceOperation: AiAppServerToolName.EnhancementDryRunCommand,
      toolCapability: AiAppServerToolCapability.Denoise,
    },
    {
      ...aiEnhancementApply,
      reason:
        'Local AI denoise apply reuses the typed AI enhancement apply tool with an accepted denoise dry-run plan and audit metadata.',
      ...mappedAppServerTool,
      sourceOperation: AiAppServerToolName.EnhancementApplyCommand,
      toolCapability: AiAppServerToolCapability.Denoise,
    },
    {
      deferredIssue: '#1963',
      reason:
        'The inherited denoise invoke multiplexes classic and AI NIND paths; app-server migration needs a separate denoise dry-run plan with model provenance before mapping.',
      sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
      sourceOperation: 'apply_denoising',
      status: AiAppServerToolRouteStatus.Deferred,
      toolCapability: AiAppServerToolCapability.Denoise,
    },
    {
      deferredIssue: '#1963',
      reason:
        'Saving denoised output is an artifact-writing apply step and must wait for an accepted AI denoise dry-run plan and audit metadata.',
      sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
      sourceOperation: 'save_denoised_image',
      status: AiAppServerToolRouteStatus.Deferred,
      toolCapability: AiAppServerToolCapability.Denoise,
    },
    {
      reason: 'Connector health is a capability/status probe, not an image edit tool call.',
      sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
      sourceOperation: 'check_ai_connector_status',
      status: AiAppServerToolRouteStatus.ConnectorStatus,
    },
    {
      reason: 'Connector test is a settings validation probe, not an image edit tool call.',
      sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
      sourceOperation: 'test_ai_connector_connection',
      status: AiAppServerToolRouteStatus.ConnectorStatus,
    },
    {
      reason: 'AI tag cleanup mutates library metadata and is tracked outside image-edit app-server tools.',
      sourceKind: AiAppServerToolRouteSourceKind.TauriInvoke,
      sourceOperation: 'clear_ai_tags',
      status: AiAppServerToolRouteStatus.MetadataCleanup,
    },
  ],
  schemaVersion: 1,
});

export const AI_APP_SERVER_TOOL_ROUTES: ReadonlyArray<AiAppServerToolRoute> = AI_APP_SERVER_TOOL_ROUTE_MANIFEST.routes;
