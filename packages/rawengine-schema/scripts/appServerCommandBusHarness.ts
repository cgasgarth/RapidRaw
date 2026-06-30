import { z } from 'zod';

import {
  type ComputationalMergeAppServerToolDefinitionV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeMutationResultV1Schema,
} from '../src/rawEngineSchemas.js';

export const computationalMergeAppServerCommandBusResultSchema = z.discriminatedUnion('kind', [
  z
    .object({
      dryRunResult: z.custom<ComputationalMergeDryRunResultV1>(),
      kind: z.literal('dry_run'),
      toolName: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('apply'),
      mutationResult: z.custom<ComputationalMergeMutationResultV1>(),
      toolName: z.string().min(1),
    })
    .strict(),
]);

export type ComputationalMergeAppServerCommandBusResult = z.infer<
  typeof computationalMergeAppServerCommandBusResultSchema
>;

interface DryRunBuildResult {
  acceptedDryRunPlanHash: string;
  dryRunResult: ComputationalMergeDryRunResultV1;
}

export interface ComputationalMergeAppServerCommandBusHarnessOptions {
  buildApply: (
    tool: ComputationalMergeAppServerToolDefinitionV1,
    command: ComputationalMergeCommandEnvelopeV1,
  ) => ComputationalMergeMutationResultV1;
  buildDryRun: (
    tool: ComputationalMergeAppServerToolDefinitionV1,
    command: ComputationalMergeCommandEnvelopeV1,
  ) => DryRunBuildResult;
  commandType: ComputationalMergeCommandEnvelopeV1['commandType'];
  familyLabel: string;
  manifestValue: unknown;
}

export class ComputationalMergeAppServerCommandBusHarness {
  readonly #acceptedDryRunPlanHashesById = new Map<string, string>();
  readonly #buildApply: ComputationalMergeAppServerCommandBusHarnessOptions['buildApply'];
  readonly #buildDryRun: ComputationalMergeAppServerCommandBusHarnessOptions['buildDryRun'];
  readonly #commandType: ComputationalMergeCommandEnvelopeV1['commandType'];
  readonly #familyLabel: string;
  readonly #toolsByName = new Map<string, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(options: ComputationalMergeAppServerCommandBusHarnessOptions) {
    this.#buildApply = options.buildApply;
    this.#buildDryRun = options.buildDryRun;
    this.#commandType = options.commandType;
    this.#familyLabel = options.familyLabel;

    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(options.manifestValue);
    for (const tool of manifest.tools.filter((candidateTool) =>
      candidateTool.allowedCommandTypes.includes(options.commandType),
    )) {
      this.#toolsByName.set(tool.toolName, tool);
    }
  }

  execute(toolName: string, commandValue: unknown): ComputationalMergeAppServerCommandBusResult {
    const tool = this.#toolsByName.get(toolName);
    if (tool === undefined) {
      throw new Error(`${this.#familyLabel} app-server command bus has no registered tool named ${toolName}.`);
    }

    const command = computationalMergeCommandEnvelopeV1Schema.parse(commandValue);
    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    if (tool.executionMode === 'dry_run_command') {
      return this.#executeDryRun(tool, command);
    }

    return this.#executeApply(tool, command);
  }

  #executeDryRun(
    tool: ComputationalMergeAppServerToolDefinitionV1,
    command: ComputationalMergeCommandEnvelopeV1,
  ): ComputationalMergeAppServerCommandBusResult {
    if (!command.dryRun) {
      throw new Error(`${tool.toolName} requires a dry-run command envelope.`);
    }

    const { acceptedDryRunPlanHash, dryRunResult } = this.#buildDryRun(tool, command);
    this.#acceptedDryRunPlanHashesById.set(dryRunResult.mergePlan.planId, acceptedDryRunPlanHash);
    return computationalMergeAppServerCommandBusResultSchema.parse({
      dryRunResult,
      kind: 'dry_run',
      toolName: tool.toolName,
    });
  }

  #executeApply(
    tool: ComputationalMergeAppServerToolDefinitionV1,
    command: ComputationalMergeCommandEnvelopeV1,
  ): ComputationalMergeAppServerCommandBusResult {
    if (command.dryRun) {
      throw new Error(`${tool.toolName} requires an apply command envelope.`);
    }

    if (command.commandType !== this.#commandType) {
      throw new Error(`${tool.toolName} only applies ${this.#familyLabel} commands.`);
    }

    const acceptedPlanId = command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || !this.#acceptedDryRunPlanHashesById.has(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected unaccepted dry-run plan ${String(acceptedPlanId)}.`);
    }

    if (acceptedPlanHash !== this.#acceptedDryRunPlanHashesById.get(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected mismatched dry-run plan hash ${String(acceptedPlanHash)}.`);
    }

    return computationalMergeAppServerCommandBusResultSchema.parse({
      kind: 'apply',
      mutationResult: computationalMergeMutationResultV1Schema.parse(this.#buildApply(tool, command)),
      toolName: tool.toolName,
    });
  }
}

export const expectThrows = (label: string, callback: () => unknown) => {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
};
