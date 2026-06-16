import { z } from 'zod';

import {
  applyFocusStackRuntimePlanV1,
  buildFocusStackRuntimeDryRunV1,
  focusStackRuntimePlanRequestV1Schema,
  type FocusStackRuntimeApplyResultV1,
  type FocusStackRuntimeDryRunResultV1,
  type FocusStackRuntimePlanRequestV1,
} from './focusStackRuntimePlan.js';
import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
} from './rawEngineSchemas.js';

export const focusStackAppServerRuntimeToolNameV1Schema = z.enum([
  'computationalmerge.focus_stack.dry_run_command',
  'computationalmerge.focus_stack.apply_command',
]);

export const focusStackAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: focusStackRuntimePlanRequestV1Schema,
    toolName: focusStackAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type FocusStackAppServerRuntimeToolNameV1 = z.infer<typeof focusStackAppServerRuntimeToolNameV1Schema>;

export interface FocusStackAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: FocusStackRuntimeDryRunResultV1;
  kind: 'dry_run';
  toolName: FocusStackAppServerRuntimeToolNameV1;
}

export interface FocusStackAppServerRuntimeApplyToolResultV1 {
  apply: FocusStackRuntimeApplyResultV1;
  kind: 'apply';
  toolName: FocusStackAppServerRuntimeToolNameV1;
}

export type FocusStackAppServerRuntimeToolResultV1 =
  | FocusStackAppServerRuntimeApplyToolResultV1
  | FocusStackAppServerRuntimeDryRunToolResultV1;

export class FocusStackAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlanHashesById: Map<string, string> = new Map<string, string>();
  readonly #toolsByName: Map<FocusStackAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1> =
    new Map<FocusStackAppServerRuntimeToolNameV1, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = focusStackAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success && tool.allowedCommandTypes.includes('computationalMerge.createFocusStack')) {
        this.#toolsByName.set(parsedToolName.data, tool);
      }
    }
  }

  execute(requestValue: unknown): FocusStackAppServerRuntimeToolResultV1 {
    const request = focusStackAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Focus stack runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(request.request.command);
    if (command.commandType !== 'computationalMerge.createFocusStack') {
      throw new Error(`${tool.toolName} only supports focus stack command envelopes.`);
    }

    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') return this.#executeDryRun(request.toolName, tool, request.request);
    return this.#executeApply(request.toolName, tool, request.request);
  }

  #executeDryRun(
    toolName: FocusStackAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: FocusStackRuntimePlanRequestV1,
  ): FocusStackAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || !request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a non-mutating dry-run command.`);
    }

    const dryRun = buildFocusStackRuntimeDryRunV1(request);
    const acceptedDryRunPlanHash = `sha256:${dryRun.dryRunResult.mergePlan.planId}`;
    this.#acceptedDryRunPlanHashesById.set(dryRun.dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return { acceptedDryRunPlanHash, dryRun, kind: 'dry_run', toolName };
  }

  #executeApply(
    toolName: FocusStackAppServerRuntimeToolNameV1,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: FocusStackRuntimePlanRequestV1,
  ): FocusStackAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a mutating apply command.`);
    }

    const acceptedPlanId = request.command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = request.command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || this.#acceptedDryRunPlanHashesById.get(acceptedPlanId) !== acceptedPlanHash) {
      throw new Error(`${tool.toolName} rejected an unaccepted focus stack dry-run plan.`);
    }

    return { apply: applyFocusStackRuntimePlanV1(request), kind: 'apply', toolName };
  }
}
