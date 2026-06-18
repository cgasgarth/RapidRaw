import { z } from 'zod';

import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabSetConversionRecipeCommandV1Schema,
  negativeWarningV1Schema,
  type NegativeLabAppServerToolDefinitionV1,
  type NegativeLabApplyPlanRequestV1,
  type NegativeLabApplyResultV1,
  type NegativeLabCommandEnvelopeV1,
  type NegativeLabDryRunResultV1,
} from './rawEngineSchemas.js';

export const negativeLabAppServerRuntimeToolNameV1Schema = z.enum([
  'negativelab.preview_conversion',
  'negativelab.apply_planned_command',
]);

export const negativeLabAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: z.unknown(),
    toolName: negativeLabAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type NegativeLabAppServerRuntimeToolNameV1 = z.infer<typeof negativeLabAppServerRuntimeToolNameV1Schema>;
export type NegativeLabAppServerRuntimeToolRequestV1 = z.infer<typeof negativeLabAppServerRuntimeToolRequestV1Schema>;
type NegativeLabSetConversionRecipeCommandV1 = z.infer<typeof negativeLabSetConversionRecipeCommandV1Schema>;

export interface NegativeLabAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: NegativeLabDryRunResultV1;
  kind: 'dry_run';
  toolName: 'negativelab.preview_conversion';
}

export interface NegativeLabAppServerRuntimeApplyToolResultV1 {
  apply: NegativeLabApplyResultV1;
  kind: 'apply';
  toolName: 'negativelab.apply_planned_command';
}

export type NegativeLabAppServerRuntimeToolResultV1 =
  | NegativeLabAppServerRuntimeApplyToolResultV1
  | NegativeLabAppServerRuntimeDryRunToolResultV1;

interface AcceptedNegativeLabDryRunPlanV1 {
  command: NegativeLabCommandEnvelopeV1;
  dryRun: NegativeLabDryRunResultV1;
  hash: string;
}

export class NegativeLabAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlansById: Map<string, AcceptedNegativeLabDryRunPlanV1> = new Map<
    string,
    AcceptedNegativeLabDryRunPlanV1
  >();
  readonly #toolsByName: Map<NegativeLabAppServerRuntimeToolNameV1, NegativeLabAppServerToolDefinitionV1> = new Map<
    NegativeLabAppServerRuntimeToolNameV1,
    NegativeLabAppServerToolDefinitionV1
  >();

  constructor(manifestValue: unknown) {
    const manifest = negativeLabAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = negativeLabAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success) this.#toolsByName.set(parsedToolName.data, tool);
    }
  }

  execute(requestValue: unknown): NegativeLabAppServerRuntimeToolResultV1 {
    const request = negativeLabAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Negative Lab runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    if (request.toolName === 'negativelab.preview_conversion') {
      return this.#executeDryRun(tool, request.request);
    }
    return this.#executeApply(tool, request.request);
  }

  #executeDryRun(
    tool: NegativeLabAppServerToolDefinitionV1,
    requestValue: unknown,
  ): NegativeLabAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || tool.executionMode !== 'dry_run_command') {
      throw new Error(`${tool.toolName} requires a non-mutating Negative Lab dry-run command.`);
    }

    const command = negativeLabCommandEnvelopeV1Schema.parse(requestValue);
    if (!command.dryRun || command.approval.approvalClass !== ApprovalClass.PreviewOnly) {
      throw new Error(`${tool.toolName} requires a preview-only dry-run command.`);
    }
    if (command.commandType !== 'negativeLab.setConversionRecipe') {
      throw new Error(`${tool.toolName} runtime proof currently supports conversion recipe dry-runs only.`);
    }
    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    const conversionCommand = negativeLabSetConversionRecipeCommandV1Schema.parse(command);
    const dryRun = buildNegativeLabRuntimeDryRunV1(conversionCommand);
    const acceptedDryRunPlanHash = negativeLabAcceptedDryRunPlanHashV1(dryRun);
    this.#acceptedDryRunPlansById.set(dryRun.dryRunPlanId, {
      command,
      dryRun,
      hash: acceptedDryRunPlanHash,
    });

    return {
      acceptedDryRunPlanHash,
      dryRun,
      kind: 'dry_run',
      toolName: 'negativelab.preview_conversion',
    };
  }

  #executeApply(
    tool: NegativeLabAppServerToolDefinitionV1,
    requestValue: unknown,
  ): NegativeLabAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || tool.executionMode !== 'apply_dry_run_plan') {
      throw new Error(`${tool.toolName} requires a mutating Negative Lab apply request.`);
    }

    const request = negativeLabApplyPlanRequestV1Schema.parse(requestValue);
    const acceptedPlan = this.#acceptedDryRunPlansById.get(request.dryRunPlanId);
    if (
      acceptedPlan === undefined ||
      acceptedPlan.hash !== request.acceptedDryRunPlanHash ||
      acceptedPlan.command.commandId !== request.commandId
    ) {
      throw new Error(`${tool.toolName} rejected an unaccepted Negative Lab dry-run plan.`);
    }

    return {
      apply: buildNegativeLabRuntimeApplyV1(request, acceptedPlan),
      kind: 'apply',
      toolName: 'negativelab.apply_planned_command',
    };
  }
}

export function negativeLabAcceptedDryRunPlanHashV1(dryRun: NegativeLabDryRunResultV1): string {
  return `sha256:${dryRun.dryRunPlanId}`;
}

function buildNegativeLabRuntimeDryRunV1(command: NegativeLabSetConversionRecipeCommandV1): NegativeLabDryRunResultV1 {
  const sessionId = command.parameters.sessionId;
  const selectedFrameIds = command.parameters.frameSelection.frameIds;
  const updatedFrameIds = selectedFrameIds.length > 0 ? selectedFrameIds : ['negative_lab_frame_runtime_preview'];
  const warnings = [negativeLabRuntimeWarningV1(updatedFrameIds)];
  const warningCodes = warnings.map((warning) => warning.code);
  const artifactId = `artifact_${command.commandId}_preview`;

  return {
    changeSet: {
      artifactHandles: [
        {
          artifactId,
          contentHash: `sha256:${command.commandId}:preview`,
          dimensions: { height: 900, width: 1350 },
          kind: 'preview',
          storage: 'temp_cache',
        },
      ],
      createdPositiveVariantIds: [],
      provenanceEntryIds: [`prov_${command.commandId}_dry_run`],
      updatedFrameIds,
      updatedSessionId: sessionId,
      warningCodes,
    },
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRunPlanId: `negative_lab_dry_run_plan_${command.commandId}`,
    numericMetrics: {
      affectedFrameCount: updatedFrameIds.length,
      routeProofOnly: 0,
    },
    previewArtifacts: [
      {
        artifactId,
        contentHash: `sha256:${command.commandId}:preview`,
        dimensions: { height: 900, width: 1350 },
        kind: 'preview',
        storage: 'temp_cache',
      },
    ],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    warnings,
  };
}

function buildNegativeLabRuntimeApplyV1(
  request: NegativeLabApplyPlanRequestV1,
  acceptedPlan: AcceptedNegativeLabDryRunPlanV1,
): NegativeLabApplyResultV1 {
  return {
    appliedGraphRevision: `${request.expectedSessionRevision}:negative_lab_applied`,
    changeSet: {
      artifactHandles: acceptedPlan.dryRun.previewArtifacts.map((artifact) => ({
        ...artifact,
        artifactId: `${artifact.artifactId}_accepted`,
        kind: 'export',
        storage: 'sidecar_artifact',
      })),
      createdPositiveVariantIds: acceptedPlan.dryRun.changeSet.updatedFrameIds.map(
        (frameId) => `positive_variant_${frameId}`,
      ),
      provenanceEntryIds: [`prov_${request.commandId}_apply`],
      updatedFrameIds: acceptedPlan.dryRun.changeSet.updatedFrameIds,
      updatedSessionId: request.sessionId,
      warningCodes: acceptedPlan.dryRun.changeSet.warningCodes,
    },
    commandId: `${request.commandId}_apply`,
    commandType: acceptedPlan.command.commandType,
    correlationId: acceptedPlan.command.correlationId,
    dryRunCommandId: acceptedPlan.command.commandId,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sessionId: request.sessionId,
    warnings: acceptedPlan.dryRun.warnings,
  };
}

function negativeLabRuntimeWarningV1(frameIds: Array<string>) {
  return negativeWarningV1Schema.parse({
    blocksAutomation: false,
    code: 'low_acquisition_confidence',
    evidence:
      'Synthetic Negative Lab runtime proof uses generated preview artifacts; no real scan color quality is claimed.',
    frameIds,
    scope: 'session',
    severity: 'info',
  });
}
