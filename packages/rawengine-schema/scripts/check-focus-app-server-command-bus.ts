import { createFocusStackPlanOnlyDryRunResultV1 } from '../src/focusStackPreflight.js';
import {
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  sampleFocusStackArtifactV1,
} from '../src/samplePayloads.js';
import {
  ComputationalMergeAppServerCommandBusHarness,
  type ComputationalMergeAppServerCommandBusHarnessOptions,
  expectThrows,
} from './appServerCommandBusHarness.js';

const sampleFocusStackPreflightSourceStates = sampleFocusStackArtifactV1.sourceState.map((sourceState) => ({
  contentHash: sourceState.contentHash,
  graphRevision: sourceState.graphRevision,
  sourceIndex: sourceState.sourceIndex,
}));

const focusCommandBusConfig: ComputationalMergeAppServerCommandBusHarnessOptions = {
  buildDryRun: (tool, command: ComputationalMergeCommandEnvelopeV1) => {
    const dryRunResult = createFocusStackPlanOnlyDryRunResultV1(command, {
      planId: 'merge_plan_focus_stack_app_server_bus_001',
      predictedGraphRevision: 'graph_rev_48_focus_stack_app_server_preview',
      sourceStates: sampleFocusStackPreflightSourceStates,
    });

    if (dryRunResult.mergePlan.preflight.status !== 'accepted') {
      throw new Error(`${tool.toolName} expected an accepted dry-run plan.`);
    }

    return {
      acceptedDryRunPlanHash: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanHash,
      dryRunResult,
    };
  },
  buildApply: (_tool, command: ComputationalMergeCommandEnvelopeV1) => ({
    appliedGraphRevision: 'graph_rev_48_focus_stack_app_server_apply',
    changedNodeIds: ['node_merge_focus_stack_app_server_001'],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    derivedAssetId: 'derived_focus_stack_app_server_001',
    dryRun: false,
    mutates: true,
    outputArtifacts: [
      {
        artifactId: 'artifact_focus_stack_app_server_output',
        contentHash: 'sha256:sample-focus-stack-app-server-output',
        dimensions: {
          height: 1600,
          width: 2400,
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
  commandType: 'computationalMerge.createFocusStack',
  familyLabel: 'focus-stack',
  manifestValue: sampleComputationalMergeAppServerToolManifestV1,
};

const commandBus = new ComputationalMergeAppServerCommandBusHarness(focusCommandBusConfig);

const dryRun = commandBus.execute(
  'computationalmerge.focus_stack.dry_run_command',
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
);
if (dryRun.kind !== 'dry_run') {
  throw new Error('Expected focus app-server dry-run tool to return dry_run result.');
}

const acceptedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse({
  ...sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeFocusStackApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanHash: sampleFocusStackArtifactV1.dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
});
const apply = commandBus.execute('computationalmerge.focus_stack.apply_command', acceptedApplyCommand);
if (apply.kind !== 'apply') {
  throw new Error('Expected focus app-server apply tool to return apply result.');
}

expectThrows('focus dry-run tool with panorama command', () =>
  commandBus.execute('computationalmerge.focus_stack.dry_run_command', sampleComputationalMergeCommandEnvelopeV1),
);

expectThrows('focus dry-run tool with apply command', () =>
  commandBus.execute(
    'computationalmerge.focus_stack.dry_run_command',
    sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  ),
);

expectThrows('focus apply tool without accepted dry-run plan', () =>
  new ComputationalMergeAppServerCommandBusHarness(focusCommandBusConfig).execute(
    'computationalmerge.focus_stack.apply_command',
    sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  ),
);

expectThrows('focus apply tool with mismatched dry-run plan hash', () =>
  commandBus.execute('computationalmerge.focus_stack.apply_command', {
    ...acceptedApplyCommand,
    parameters: {
      ...acceptedApplyCommand.parameters,
      acceptedDryRunPlanHash: 'sha256:mismatched-focus-plan',
    },
  }),
);

expectThrows('focus apply tool with dry-run command', () =>
  commandBus.execute(
    'computationalmerge.focus_stack.apply_command',
    sampleComputationalMergeFocusStackCommandEnvelopeV1,
  ),
);

console.log('Validated focus app-server command bus dry-run/apply tool routing.');
