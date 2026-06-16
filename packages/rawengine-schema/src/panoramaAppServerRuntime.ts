import { z } from 'zod';

import {
  buildPanoramaRuntimeDryRunV1,
  applyPanoramaRuntimePlanV1,
  panoramaRuntimePlanRequestV1Schema,
  type PanoramaRuntimeApplyResultV1,
  type PanoramaRuntimeDryRunResultV1,
  type PanoramaRuntimePlanRequestV1,
} from './panoramaRuntimePlan.js';
import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
} from './rawEngineSchemas.js';

export const panoramaAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.panorama.dry_run_command',
  'computationalmerge.panorama.apply_command',
]);

export const panoramaAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: panoramaRuntimePlanRequestV1Schema,
    toolName: panoramaAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type PanoramaAppServerRuntimeToolNameV1 = z.infer<typeof panoramaAppServerRuntimeToolNameV1Schema>;

export interface PanoramaAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: PanoramaRuntimeDryRunResultV1;
  kind: 'dry_run';
  toolName: PanoramaAppServerRuntimeToolNameV1;
}

export interface PanoramaAppServerRuntimeApplyToolResultV1 {
  apply: PanoramaRuntimeApplyResultV1;
  kind: 'apply';
  toolName: PanoramaAppServerRuntimeToolNameV1;
}

export type PanoramaAppServerRuntimeToolResultV1 =
  | PanoramaAppServerRuntimeApplyToolResultV1
  | PanoramaAppServerRuntimeDryRunToolResultV1;

export class PanoramaAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlanHashesById: Map<string, string> = new Map<string, string>();
  readonly #toolsByName: Map<PanoramaAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1> = new Map<
    PanoramaAppServerRuntimeToolNameV1,
    ComputationalMergeAppServerToolDefinitionV1
  >();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = panoramaAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success && tool.allowedCommandTypes.includes('computationalMerge.createPanorama')) {
        this.#toolsByName.set(parsedToolName.data, tool);
      }
    }
  }

  execute(requestValue: unknown): PanoramaAppServerRuntimeToolResultV1 {
    const request = panoramaAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Panorama runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(request.request.command);
    if (command.commandType !== 'computationalMerge.createPanorama') {
      throw new Error(`${tool.toolName} only supports panorama command envelopes.`);
    }

    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') return this.#executeDryRun(request.toolName, tool, request.request);
    return this.#executeApply(request.toolName, tool, request.request);
  }

  #executeDryRun(
    toolName: PanoramaAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: PanoramaRuntimePlanRequestV1,
  ): PanoramaAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || !request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a non-mutating dry-run command.`);
    }

    const dryRun = buildPanoramaRuntimeDryRunV1(request);
    const acceptedDryRunPlanHash = `sha256:${dryRun.dryRunResult.mergePlan.planId}`;
    this.#acceptedDryRunPlanHashesById.set(dryRun.dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return { acceptedDryRunPlanHash, dryRun, kind: 'dry_run', toolName };
  }

  #executeApply(
    toolName: PanoramaAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: PanoramaRuntimePlanRequestV1,
  ): PanoramaAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a mutating apply command.`);
    }

    const acceptedPlanId = request.command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = request.command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || this.#acceptedDryRunPlanHashesById.get(acceptedPlanId) !== acceptedPlanHash) {
      throw new Error(`${tool.toolName} rejected an unaccepted panorama dry-run plan.`);
    }

    return { apply: applyPanoramaRuntimePlanV1(request), kind: 'apply', toolName };
  }
}
