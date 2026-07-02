import {
  NegativeLabAppServerRuntimeToolBusV1,
  type NegativeLabAppServerRuntimeToolResultV1,
} from '../../../../packages/rawengine-schema/src/negativeLabAppServerRuntime';
import {
  ApprovalClass,
  type NegativeLabAppServerToolManifestV1,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';

export const NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME = 'negativelab.preview_conversion';
export const NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME = 'negativelab.apply_planned_command';

export const NEGATIVE_LAB_AGENT_TOOL_MANIFEST: NegativeLabAppServerToolManifestV1 = {
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  serverRuntime: 'openai_app_server',
  tools: [
    {
      allowedCommandTypes: ['negativeLab.setConversionRecipe'],
      approvalClass: ApprovalClass.PreviewOnly,
      auditEvents: ['negative_lab_dry_run_requested', 'negative_lab_dry_run_completed'],
      description: 'Preview a Negative Lab command and return a non-mutating dry-run plan.',
      executionMode: 'dry_run_command',
      inputSchemaName: 'NegativeLabCommandEnvelopeV1',
      localOnly: true,
      mutates: false,
      outputSchemaName: 'NegativeLabDryRunResultV1',
      recordsProvenance: true,
      requiresDryRunPlan: false,
      returnsArtifactHandles: true,
      toolName: NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
    },
    {
      allowedCommandTypes: ['negativeLab.setConversionRecipe'],
      approvalClass: ApprovalClass.EditApply,
      auditEvents: ['negative_lab_apply_requested', 'negative_lab_apply_completed'],
      description: 'Apply an accepted Negative Lab dry-run plan after local operator approval.',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName: 'NegativeLabApplyPlanRequestV1',
      localOnly: true,
      mutates: true,
      outputSchemaName: 'NegativeLabApplyResultV1',
      recordsProvenance: true,
      requiresDryRunPlan: true,
      returnsArtifactHandles: true,
      toolName: NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
    },
  ],
};

let negativeLabAgentToolBus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST);

export const resetNegativeLabAgentAppServerToolDispatchForTests = (): void => {
  negativeLabAgentToolBus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST);
};

export const dispatchNegativeLabAgentAppServerTool = (request: {
  arguments: unknown;
  runtimeToolName: string;
}): NegativeLabAppServerRuntimeToolResultV1 => {
  if (
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME &&
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME
  ) {
    throw new Error(`Unsupported Negative Lab agent tool: ${request.runtimeToolName}`);
  }

  return negativeLabAgentToolBus.execute({
    request: request.arguments,
    toolName: request.runtimeToolName,
  });
};
