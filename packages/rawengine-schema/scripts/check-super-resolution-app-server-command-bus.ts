import {
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  sampleSuperResolutionArtifactV1,
} from '../src/samplePayloads.js';
import { createSuperResolutionPlanOnlyDryRunResultV1 } from '../src/super-resolution/superResolutionPreflight.js';
import {
  ComputationalMergeAppServerCommandBusHarness,
  type ComputationalMergeAppServerCommandBusHarnessOptions,
  expectThrows,
} from './appServerCommandBusHarness.js';

const sampleSuperResolutionPreflightSourceStates = sampleSuperResolutionArtifactV1.sourceState.map((sourceState) => ({
  contentHash: sourceState.contentHash,
  graphRevision: sourceState.graphRevision,
  sourceIndex: sourceState.sourceIndex,
}));

const superResolutionCommandBusConfig: ComputationalMergeAppServerCommandBusHarnessOptions = {
  buildDryRun: (tool, command: ComputationalMergeCommandEnvelopeV1) => {
    const dryRunResult = createSuperResolutionPlanOnlyDryRunResultV1(command, {
      planId: 'merge_plan_super_resolution_app_server_bus_001',
      predictedGraphRevision: 'graph_rev_48_super_resolution_app_server_preview',
      sourceStates: sampleSuperResolutionPreflightSourceStates,
    });

    if (dryRunResult.mergePlan.preflight.status !== 'accepted') {
      throw new Error(`${tool.toolName} expected an accepted dry-run plan.`);
    }

    return {
      acceptedDryRunPlanHash: sampleSuperResolutionArtifactV1.dryRun.acceptedDryRunPlanHash,
      dryRunResult,
    };
  },
  buildApply: (_tool, command: ComputationalMergeCommandEnvelopeV1) => ({
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
  }),
  commandType: 'computationalMerge.createSuperResolution',
  familyLabel: 'super-resolution',
  manifestValue: sampleComputationalMergeAppServerToolManifestV1,
};

const commandBus = new ComputationalMergeAppServerCommandBusHarness(superResolutionCommandBusConfig);
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
    acceptedDryRunPlanHash: sampleSuperResolutionArtifactV1.dryRun.acceptedDryRunPlanHash,
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
  new ComputationalMergeAppServerCommandBusHarness(superResolutionCommandBusConfig).execute(
    'computationalmerge.super_resolution.apply_command',
    sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  ),
);

expectThrows('super-resolution apply tool with mismatched dry-run plan hash', () =>
  commandBus.execute('computationalmerge.super_resolution.apply_command', {
    ...acceptedApplyCommand,
    parameters: {
      ...acceptedApplyCommand.parameters,
      acceptedDryRunPlanHash: 'sha256:mismatched-super-resolution-plan',
    },
  }),
);

expectThrows('super-resolution apply tool with dry-run command', () =>
  commandBus.execute(
    'computationalmerge.super_resolution.apply_command',
    sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  ),
);

console.log('Validated super-resolution app-server command bus dry-run/apply tool routing.');
