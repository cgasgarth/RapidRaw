import { z } from 'zod';

import {
  applyHdrRuntimePlanV1,
  buildHdrRuntimeDryRunV1,
  hdrRuntimePlanRequestV1Schema,
  type HdrRuntimeApplyResultV1,
  type HdrRuntimeDryRunResultV1,
  type HdrRuntimePlanRequestV1,
} from './hdrRuntimePlan.js';
import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
} from './rawEngineSchemas.js';

export const hdrAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.hdr.dry_run_command',
  'computationalmerge.hdr.apply_command',
]);

export const hdrAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: hdrRuntimePlanRequestV1Schema,
    toolName: hdrAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type HdrAppServerRuntimeToolNameV1 = z.infer<typeof hdrAppServerRuntimeToolNameV1Schema>;

export interface HdrAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: HdrRuntimeDryRunResultV1;
  kind: 'dry_run';
  toolName: HdrAppServerRuntimeToolNameV1;
}

export interface HdrAppServerRuntimeApplyToolResultV1 {
  apply: HdrRuntimeApplyResultV1;
  kind: 'apply';
  toolName: HdrAppServerRuntimeToolNameV1;
}

export type HdrAppServerRuntimeToolResultV1 =
  | HdrAppServerRuntimeApplyToolResultV1
  | HdrAppServerRuntimeDryRunToolResultV1;

export class HdrAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlanHashesById: Map<string, string> = new Map<string, string>();
  readonly #toolsByName: Map<HdrAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1> = new Map<
    HdrAppServerRuntimeToolNameV1,
    ComputationalMergeAppServerToolDefinitionV1
  >();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = hdrAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success && tool.allowedCommandTypes.includes('computationalMerge.createHdr')) {
        this.#toolsByName.set(parsedToolName.data, tool);
      }
    }
  }

  execute(requestValue: unknown): HdrAppServerRuntimeToolResultV1 {
    const request = hdrAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`HDR runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(request.request.command);
    if (command.commandType !== 'computationalMerge.createHdr') {
      throw new Error(`${tool.toolName} only supports HDR command envelopes.`);
    }

    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') return this.#executeDryRun(request.toolName, tool, request.request);
    return this.#executeApply(request.toolName, tool, request.request);
  }

  #executeDryRun(
    toolName: HdrAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: HdrRuntimePlanRequestV1,
  ): HdrAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || !request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a non-mutating dry-run command.`);
    }

    const dryRun = buildHdrRuntimeDryRunV1(request);
    const acceptedDryRunPlanHash = `sha256:${dryRun.dryRunResult.mergePlan.planId}`;
    this.#acceptedDryRunPlanHashesById.set(dryRun.dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return { acceptedDryRunPlanHash, dryRun, kind: 'dry_run', toolName };
  }

  #executeApply(
    toolName: HdrAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: HdrRuntimePlanRequestV1,
  ): HdrAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a mutating apply command.`);
    }

    const acceptedPlanId = request.command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = request.command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || this.#acceptedDryRunPlanHashesById.get(acceptedPlanId) !== acceptedPlanHash) {
      throw new Error(`${tool.toolName} rejected an unaccepted HDR dry-run plan.`);
    }

    return { apply: applyHdrRuntimePlanV1(request), kind: 'apply', toolName };
  }
}
