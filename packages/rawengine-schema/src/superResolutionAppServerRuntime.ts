import { z } from 'zod';

import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
} from './rawEngineSchemas.js';
import {
  applySuperResolutionRuntimePlanV1,
  buildSuperResolutionRuntimeDryRunV1,
  superResolutionRuntimePlanRequestV1Schema,
  type SuperResolutionRuntimeApplyResultV1,
  type SuperResolutionRuntimeDryRunResultV1,
  type SuperResolutionRuntimePlanRequestV1,
} from './superResolutionRuntimePlan.js';

export const superResolutionAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.super_resolution.dry_run_command',
  'computationalmerge.super_resolution.apply_command',
]);

export const superResolutionAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: superResolutionRuntimePlanRequestV1Schema,
    toolName: superResolutionAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type SuperResolutionAppServerRuntimeToolNameV1 = z.infer<typeof superResolutionAppServerRuntimeToolNameV1Schema>;
export type SuperResolutionAppServerRuntimeToolRequestV1 = z.infer<
  typeof superResolutionAppServerRuntimeToolRequestV1Schema
>;

export interface SuperResolutionAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: SuperResolutionRuntimeDryRunResultV1;
  kind: 'dry_run';
  toolName: SuperResolutionAppServerRuntimeToolNameV1;
}

export interface SuperResolutionAppServerRuntimeApplyToolResultV1 {
  apply: SuperResolutionRuntimeApplyResultV1;
  kind: 'apply';
  toolName: SuperResolutionAppServerRuntimeToolNameV1;
}

export type SuperResolutionAppServerRuntimeToolResultV1 =
  | SuperResolutionAppServerRuntimeApplyToolResultV1
  | SuperResolutionAppServerRuntimeDryRunToolResultV1;

export class SuperResolutionAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlanHashesById: Map<string, string> = new Map<string, string>();
  readonly #toolsByName: Map<SuperResolutionAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1> =
    new Map<SuperResolutionAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = superResolutionAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success && tool.allowedCommandTypes.includes('computationalMerge.createSuperResolution')) {
        this.#toolsByName.set(parsedToolName.data, tool);
      }
    }
  }

  execute(requestValue: unknown): SuperResolutionAppServerRuntimeToolResultV1 {
    const request = superResolutionAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Super-resolution runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(request.request.command);
    if (command.commandType !== 'computationalMerge.createSuperResolution') {
      throw new Error(`${tool.toolName} only supports super-resolution command envelopes.`);
    }

    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') {
      return this.#executeDryRun(request.toolName, tool, request.request);
    }

    return this.#executeApply(request.toolName, tool, request.request);
  }

  #executeDryRun(
    toolName: SuperResolutionAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: SuperResolutionRuntimePlanRequestV1,
  ): SuperResolutionAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || !request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a non-mutating dry-run command.`);
    }

    const dryRun = buildSuperResolutionRuntimeDryRunV1(request);
    const acceptedDryRunPlanHash = `sha256:${dryRun.dryRunResult.mergePlan.planId}`;
    this.#acceptedDryRunPlanHashesById.set(dryRun.dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return {
      acceptedDryRunPlanHash,
      dryRun,
      kind: 'dry_run',
      toolName,
    };
  }

  #executeApply(
    toolName: SuperResolutionAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: SuperResolutionRuntimePlanRequestV1,
  ): SuperResolutionAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a mutating apply command.`);
    }

    const acceptedPlanId = request.command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = request.command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || this.#acceptedDryRunPlanHashesById.get(acceptedPlanId) !== acceptedPlanHash) {
      throw new Error(`${tool.toolName} rejected an unaccepted super-resolution dry-run plan.`);
    }

    return {
      apply: applySuperResolutionRuntimePlanV1(request),
      kind: 'apply',
      toolName,
    };
  }
}
