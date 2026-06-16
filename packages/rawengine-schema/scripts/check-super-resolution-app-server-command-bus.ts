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
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  sampleSuperResolutionArtifactV1,
} from '../src/samplePayloads.js';
import { createSuperResolutionPlanOnlyDryRunResultV1 } from '../src/superResolutionPreflight.js';

const SuperResolutionAppServerCommandBusResultSchema = z.discriminatedUnion('kind', [
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

const sampleSuperResolutionPreflightSourceStates = sampleSuperResolutionArtifactV1.sourceState.map((sourceState) => ({
  contentHash: sourceState.contentHash,
  graphRevision: sourceState.graphRevision,
  sourceIndex: sourceState.sourceIndex,
}));

class SuperResolutionAppServerCommandBus {
  readonly #acceptedDryRunPlanIds = new Set<string>();
  readonly #toolsByName = new Map<string, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools.filter((candidateTool) =>
      candidateTool.allowedCommandTypes.includes('computationalMerge.createSuperResolution'),
    )) {
      this.#toolsByName.set(tool.toolName, tool);
    }
  }

  execute(toolName: string, commandValue: unknown) {
    const tool = this.#toolsByName.get(toolName);
    if (tool === undefined) {
      throw new Error(`Super-resolution app-server command bus has no registered tool named ${toolName}.`);
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

    const dryRunResult = createSuperResolutionPlanOnlyDryRunResultV1(command, {
      planId: 'merge_plan_super_resolution_app_server_bus_001',
      predictedGraphRevision: 'graph_rev_48_super_resolution_app_server_preview',
      sourceStates: sampleSuperResolutionPreflightSourceStates,
    });

    if (dryRunResult.mergePlan.preflight.status !== 'accepted') {
      throw new Error(`${tool.toolName} expected an accepted dry-run plan.`);
    }

    this.#acceptedDryRunPlanIds.add(dryRunResult.mergePlan.planId);
    return SuperResolutionAppServerCommandBusResultSchema.parse({
      dryRunResult,
      kind: 'dry_run',
      toolName: tool.toolName,
    });
  }

  #executeApply(tool: ComputationalMergeAppServerToolDefinitionV1, command: ComputationalMergeCommandEnvelopeV1) {
    if (command.dryRun) {
      throw new Error(`${tool.toolName} requires an apply command envelope.`);
    }

    if (command.commandType !== 'computationalMerge.createSuperResolution') {
      throw new Error(`${tool.toolName} only applies super-resolution commands.`);
    }

    const acceptedPlanId = command.parameters.acceptedDryRunPlanId;
    const acceptedPlanHash = command.parameters.acceptedDryRunPlanHash;
    if (acceptedPlanId === undefined || acceptedPlanHash === undefined) {
      throw new Error(`${tool.toolName} requires accepted dry-run plan id and hash.`);
    }

    if (!this.#acceptedDryRunPlanIds.has(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected unaccepted dry-run plan ${acceptedPlanId}.`);
    }

    const mutationResult = computationalMergeMutationResultV1Schema.parse({
      appliedGraphRevision: 'graph_rev_48_super_resolution_app_server_apply',
      changedNodeIds: ['node_merge_super_resolution_app_server_001'],
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId: command.correlationId,
      derivedAssetId: 'derived_super_resolution_app_server_001',
      dryRun: false,
      mutates: true,
      outputArtifacts: [
        {
          artifactId: 'artifact_super_resolution_app_server_output',
          contentHash: 'sha256:sample-super-resolution-app-server-output',
          dimensions: {
            height: 3202,
            width: 4800,
          },
          kind: 'merge_output',
          storage: 'sidecar_artifact',
        },
      ],
      schemaVersion: command.schemaVersion,
      sourceGraphRevision: command.expectedGraphRevision,
      undoRevision: command.expectedGraphRevision,
      warnings: [],
    });

    return SuperResolutionAppServerCommandBusResultSchema.parse({
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

const commandBus = new SuperResolutionAppServerCommandBus(sampleComputationalMergeAppServerToolManifestV1);
const dryRun = commandBus.execute(
  'computationalmerge.super_resolution.dry_run_command',
  sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
);
if (dryRun.kind !== 'dry_run') {
  throw new Error('Expected super-resolution app-server dry-run tool to return dry_run result.');
}

const acceptedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse({
  ...sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
});
const apply = commandBus.execute('computationalmerge.super_resolution.apply_command', acceptedApplyCommand);
if (apply.kind !== 'apply') {
  throw new Error('Expected super-resolution app-server apply tool to return apply result.');
}

expectThrows('super-resolution dry-run tool with panorama command', () =>
  commandBus.execute('computationalmerge.super_resolution.dry_run_command', sampleComputationalMergeCommandEnvelopeV1),
);

expectThrows('super-resolution dry-run tool with apply command', () =>
  commandBus.execute(
    'computationalmerge.super_resolution.dry_run_command',
    sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  ),
);

expectThrows('super-resolution apply tool without accepted dry-run plan', () =>
  commandBus.execute(
    'computationalmerge.super_resolution.apply_command',
    sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  ),
);

expectThrows('super-resolution apply tool with dry-run command', () =>
  commandBus.execute(
    'computationalmerge.super_resolution.apply_command',
    sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  ),
);

console.log('Validated super-resolution app-server command bus dry-run/apply tool routing.');
