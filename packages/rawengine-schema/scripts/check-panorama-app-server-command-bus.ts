import { z } from 'zod';

import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeMutationResultV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeApplyCommandEnvelopeV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeDryRunResultV1,
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  sampleComputationalMergeMutationResultV1,
} from '../src/samplePayloads.js';

const PanoramaAppServerCommandBusResultSchema = z.discriminatedUnion('kind', [
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

class PanoramaAppServerCommandBus {
  readonly #acceptedDryRunPlanHashesById = new Map<string, string>();
  readonly #toolsByName = new Map<string, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools.filter((candidateTool) =>
      candidateTool.allowedCommandTypes.includes('computationalMerge.createPanorama'),
    )) {
      this.#toolsByName.set(tool.toolName, tool);
    }
  }

  execute(toolName: string, commandValue: unknown) {
    const tool = this.#toolsByName.get(toolName);
    if (tool === undefined) {
      throw new Error(`Panorama app-server command bus has no registered tool named ${toolName}.`);
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

  #executeDryRun(tool: ComputationalMergeAppServerToolDefinitionV1, command: ComputationalMergeCommandEnvelopeV1) {
    if (!command.dryRun) {
      throw new Error(`${tool.toolName} requires a dry-run command envelope.`);
    }

    const dryRunResult = {
      ...sampleComputationalMergeDryRunResultV1,
      commandId: command.commandId,
      correlationId: command.correlationId,
      mergePlan: {
        ...sampleComputationalMergeDryRunResultV1.mergePlan,
        outputName: command.parameters.outputName,
        sourceImageRefs: command.parameters.sources,
      },
      sourceGraphRevision: command.expectedGraphRevision,
    };

    const acceptedPlanHash = sampleComputationalMergeApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanHash === undefined) {
      throw new Error(`${tool.toolName} sample apply command is missing an accepted dry-run plan hash.`);
    }

    this.#acceptedDryRunPlanHashesById.set(dryRunResult.mergePlan.planId, acceptedPlanHash);
    return PanoramaAppServerCommandBusResultSchema.parse({
      dryRunResult,
      kind: 'dry_run',
      toolName: tool.toolName,
    });
  }

  #executeApply(tool: ComputationalMergeAppServerToolDefinitionV1, command: ComputationalMergeCommandEnvelopeV1) {
    if (command.dryRun) {
      throw new Error(`${tool.toolName} requires an apply command envelope.`);
    }

    if (command.commandType !== 'computationalMerge.createPanorama') {
      throw new Error(`${tool.toolName} only applies panorama commands.`);
    }

    const acceptedPlanId = command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || !this.#acceptedDryRunPlanHashesById.has(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected unaccepted dry-run plan ${String(acceptedPlanId)}.`);
    }

    if (acceptedPlanHash !== this.#acceptedDryRunPlanHashesById.get(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected mismatched dry-run plan hash ${String(acceptedPlanHash)}.`);
    }

    const mutationResult = computationalMergeMutationResultV1Schema.parse({
      ...sampleComputationalMergeMutationResultV1,
      commandId: command.commandId,
      correlationId: command.correlationId,
      sourceGraphRevision: command.expectedGraphRevision,
      undoRevision: command.expectedGraphRevision,
    });

    return PanoramaAppServerCommandBusResultSchema.parse({
      kind: 'apply',
      mutationResult,
      toolName: tool.toolName,
    });
  }
}

const expectThrows = (label: string, callback: () => unknown) => {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
};

const commandBus = new PanoramaAppServerCommandBus(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = commandBus.execute(
  'computationalmerge.panorama.dry_run_command',
  sampleComputationalMergeCommandEnvelopeV1,
);
if (dryRun.kind !== 'dry_run') {
  throw new Error('Expected panorama app-server dry-run tool to return dry_run result.');
}

const acceptedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse({
  ...sampleComputationalMergeApplyCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanHash: sampleComputationalMergeApplyCommandEnvelopeV1.parameters.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
});
const apply = commandBus.execute('computationalmerge.panorama.apply_command', acceptedApplyCommand);
if (apply.kind !== 'apply') {
  throw new Error('Expected panorama app-server apply tool to return apply result.');
}

expectThrows('panorama dry-run tool with focus command', () =>
  commandBus.execute(
    'computationalmerge.panorama.dry_run_command',
    sampleComputationalMergeFocusStackCommandEnvelopeV1,
  ),
);

expectThrows('panorama dry-run tool with apply command', () =>
  commandBus.execute('computationalmerge.panorama.dry_run_command', acceptedApplyCommand),
);

expectThrows('panorama apply tool before accepted dry-run', () =>
  new PanoramaAppServerCommandBus(sampleComputationalMergeAppServerToolManifestV1).execute(
    'computationalmerge.panorama.apply_command',
    acceptedApplyCommand,
  ),
);

expectThrows('panorama apply tool with mismatched dry-run plan hash', () =>
  commandBus.execute('computationalmerge.panorama.apply_command', {
    ...acceptedApplyCommand,
    parameters: {
      ...acceptedApplyCommand.parameters,
      acceptedDryRunPlanHash: 'sha256:mismatched-panorama-plan',
    },
  }),
);

console.log('Panorama app-server command bus ok');
