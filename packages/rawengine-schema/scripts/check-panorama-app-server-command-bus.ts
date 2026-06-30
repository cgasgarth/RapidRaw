import {
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeApplyCommandEnvelopeV1,
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeDryRunResultV1,
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  sampleComputationalMergeMutationResultV1,
} from '../src/samplePayloads.js';
import {
  ComputationalMergeAppServerCommandBusHarness,
  type ComputationalMergeAppServerCommandBusHarnessOptions,
  expectThrows,
} from './appServerCommandBusHarness.js';

const panoramaCommandBusConfig: ComputationalMergeAppServerCommandBusHarnessOptions = {
  buildDryRun: (tool, command: ComputationalMergeCommandEnvelopeV1) => {
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

    return { acceptedDryRunPlanHash: acceptedPlanHash, dryRunResult };
  },
  buildApply: (_tool, command: ComputationalMergeCommandEnvelopeV1) => ({
    ...sampleComputationalMergeMutationResultV1,
    commandId: command.commandId,
    correlationId: command.correlationId,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
  }),
  commandType: 'computationalMerge.createPanorama',
  familyLabel: 'panorama',
  manifestValue: sampleComputationalMergeAppServerToolManifestV1,
};
const commandBus = new ComputationalMergeAppServerCommandBusHarness(panoramaCommandBusConfig);
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
  new ComputationalMergeAppServerCommandBusHarness(panoramaCommandBusConfig).execute(
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
