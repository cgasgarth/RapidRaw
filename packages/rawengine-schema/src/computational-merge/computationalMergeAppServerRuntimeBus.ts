import type { z } from 'zod';
import {
  type ComputationalMergeAppServerToolDefinitionV1,
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
} from '../rawEngineSchemas.js';

export interface ComputationalMergeRuntimeRequestEnvelopeV1<TToolName extends string, TRequest> {
  request: TRequest;
  toolName: TToolName;
}

export interface ComputationalMergeRuntimeDryRunLikeV1 {
  acceptedDryRunPlanHash?: string;
  dryRunResult: {
    mergePlan: {
      planId: string;
    };
  };
}

export interface ComputationalMergeRuntimeDryRunToolResultV1<TToolName extends string, TDryRun> {
  acceptedDryRunPlanHash: string;
  dryRun: TDryRun;
  kind: 'dry_run';
  toolName: TToolName;
}

export interface ComputationalMergeRuntimeApplyToolResultV1<TToolName extends string, TApply> {
  apply: TApply;
  kind: 'apply';
  toolName: TToolName;
}

export type ComputationalMergeRuntimeToolResultV1<TToolName extends string, TDryRun, TApply> =
  | ComputationalMergeRuntimeApplyToolResultV1<TToolName, TApply>
  | ComputationalMergeRuntimeDryRunToolResultV1<TToolName, TDryRun>;

type ComputationalMergeRuntimeRequestV1 = {
  command: ComputationalMergeCommandEnvelopeV1;
};

export interface ComputationalMergeRuntimeBusOptionsV1<
  TToolName extends string,
  TRequest extends ComputationalMergeRuntimeRequestV1,
  TDryRun extends ComputationalMergeRuntimeDryRunLikeV1,
  TApply,
> {
  applyBuilder: (request: TRequest) => TApply;
  commandType: ComputationalMergeCommandEnvelopeV1['commandType'];
  commandEnvelopeLabel: string;
  dryRunBuilder: (request: TRequest) => TDryRun;
  dryRunPlanLabel: string;
  requestSchema: z.ZodType<ComputationalMergeRuntimeRequestEnvelopeV1<TToolName, TRequest>>;
  runtimeLabel: string;
  toolNameSchema: z.ZodType<TToolName>;
}

export class ComputationalMergeAppServerRuntimeToolBusV1<
  TToolName extends string,
  TRequest extends ComputationalMergeRuntimeRequestV1,
  TDryRun extends ComputationalMergeRuntimeDryRunLikeV1,
  TApply,
> {
  readonly #acceptedDryRunPlanHashesById: Map<string, string> = new Map<string, string>();
  readonly #options: ComputationalMergeRuntimeBusOptionsV1<TToolName, TRequest, TDryRun, TApply>;
  readonly #toolsByName: Map<TToolName, ComputationalMergeAppServerToolDefinitionV1> = new Map<
    TToolName,
    ComputationalMergeAppServerToolDefinitionV1
  >();

  constructor(
    manifestValue: unknown,
    options: ComputationalMergeRuntimeBusOptionsV1<TToolName, TRequest, TDryRun, TApply>,
  ) {
    this.#options = options;
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools) {
      const parsedToolName = options.toolNameSchema.safeParse(tool.toolName);
      if (parsedToolName.success && tool.allowedCommandTypes.includes(options.commandType)) {
        this.#toolsByName.set(parsedToolName.data, tool);
      }
    }
  }

  execute(requestValue: unknown): ComputationalMergeRuntimeToolResultV1<TToolName, TDryRun, TApply> {
    const request = this.#options.requestSchema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(
        `${this.#options.runtimeLabel} runtime app-server bus has no registered tool named ${request.toolName}.`,
      );
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(request.request.command);
    if (command.commandType !== this.#options.commandType) {
      throw new Error(`${tool.toolName} only supports ${this.#options.commandEnvelopeLabel} command envelopes.`);
    }

    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') return this.#executeDryRun(request.toolName, tool, request.request);
    return this.#executeApply(request.toolName, tool, request.request);
  }

  #executeDryRun(
    toolName: TToolName,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: TRequest,
  ): ComputationalMergeRuntimeDryRunToolResultV1<TToolName, TDryRun> {
    if (tool.mutates || tool.requiresDryRunPlan || !request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a non-mutating dry-run command.`);
    }

    const dryRun = this.#options.dryRunBuilder(request);
    const acceptedDryRunPlanHash = dryRun.acceptedDryRunPlanHash ?? `sha256:${dryRun.dryRunResult.mergePlan.planId}`;
    this.#acceptedDryRunPlanHashesById.set(dryRun.dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return { acceptedDryRunPlanHash, dryRun, kind: 'dry_run', toolName };
  }

  #executeApply(
    toolName: TToolName,
    tool: ComputationalMergeAppServerToolDefinitionV1,
    request: TRequest,
  ): ComputationalMergeRuntimeApplyToolResultV1<TToolName, TApply> {
    if (!tool.mutates || !tool.requiresDryRunPlan || request.command.dryRun) {
      throw new Error(`${tool.toolName} requires a mutating apply command.`);
    }

    const acceptedPlanId = request.command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = request.command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || this.#acceptedDryRunPlanHashesById.get(acceptedPlanId) !== acceptedPlanHash) {
      throw new Error(`${tool.toolName} rejected an unaccepted ${this.#options.dryRunPlanLabel} dry-run plan.`);
    }

    return { apply: this.#options.applyBuilder(request), kind: 'apply', toolName };
  }
}
