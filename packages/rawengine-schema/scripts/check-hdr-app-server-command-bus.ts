import {
  type ComputationalMergeCommandEnvelopeV1,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeHdrCommandEnvelopeV1,
  sampleHdrMergeArtifactV1,
} from '../src/samplePayloads.js';
import {
  ComputationalMergeAppServerCommandBusHarness,
  type ComputationalMergeAppServerCommandBusHarnessOptions,
  expectThrows,
} from './appServerCommandBusHarness.js';

const hdrCommandBusConfig: ComputationalMergeAppServerCommandBusHarnessOptions = {
  buildDryRun: (_tool, command: ComputationalMergeCommandEnvelopeV1) => {
    const outputDimensions = sampleHdrMergeArtifactV1.outputArtifact.dimensions;
    if (outputDimensions === undefined) {
      throw new Error('Sample HDR artifact requires output dimensions for app-server dry-run planning.');
    }

    const dryRunResult = computationalMergeDryRunResultV1Schema.parse({
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId: command.correlationId,
      dryRun: true,
      mergePlan: {
        family: 'hdr',
        outputDimensions: {
          height: outputDimensions.height,
          width: outputDimensions.width,
        },
        outputName: command.parameters.outputName,
        performanceEstimate: {
          estimatedPeakMemoryBytes: 1_100_000_000,
          estimatedRuntimeMs: 4200,
          requiresBackgroundJob: true,
        },
        planId: sampleHdrMergeArtifactV1.dryRun.acceptedDryRunPlanId,
        preflight: {
          blockedReasons: [],
          engineCapabilities: {
            fullFrameLegacy: true,
            maxPreviewDimensionPx: command.parameters.maxPreviewDimensionPx,
            planOnly: true,
            tileBackedRender: false,
          },
          executionMode: 'full_frame_legacy',
          geometryEstimate: {
            outputPixelCount: outputDimensions.height * outputDimensions.width,
            projectedBounds: {
              height: outputDimensions.height,
              width: outputDimensions.width,
              x: 0,
              y: 0,
            },
            sourceCount: command.parameters.sources.length,
            sourcePixelCount: 72_000_000,
          },
          memoryBudgetBytes: 4_000_000_000,
          memoryBudgetRatio: 0.275,
          memoryComponents: {
            lowDetailMaskBytes: 6_000_000,
            outputCanvasBytes: 288_000_000,
            outputMaskBytes: 24_000_000,
            overheadBytes: 82_000_000,
            previewBytes: 24_000_000,
            seamWorkspaceBytes: 76_000_000,
            sourceDecodeBytes: 600_000_000,
            totalEstimatedPeakBytes: 1_100_000_000,
          },
          status: 'accepted',
          tileCount: 1,
          warningCodes: ['legacy_full_frame_render'],
        },
        qualityMetrics: {
          alignmentConfidence: sampleHdrMergeArtifactV1.alignment.alignmentConfidence,
          deghostingRisk: sampleHdrMergeArtifactV1.deghosting.motionRisk,
          sourceCount: command.parameters.sources.length,
        },
        sourceImageRefs: command.parameters.sources,
        warnings: sampleHdrMergeArtifactV1.warningCodes,
      },
      mutates: false,
      predictedGraphRevision: 'graph_rev_48_hdr_preview',
      previewArtifacts: sampleHdrMergeArtifactV1.previewArtifacts,
      schemaVersion: command.schemaVersion,
      sourceGraphRevision: command.expectedGraphRevision,
      warnings: ['HDR preview is tone mapped; final scene-linear output remains an apply step.'],
    });

    return {
      acceptedDryRunPlanHash: sampleHdrMergeArtifactV1.dryRun.acceptedDryRunPlanHash,
      dryRunResult,
    };
  },
  buildApply: (_tool, command: ComputationalMergeCommandEnvelopeV1) => ({
    appliedGraphRevision: 'graph_rev_48_hdr_apply',
    changedNodeIds: ['node_merge_hdr_app_server_001'],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    derivedAssetId: sampleHdrMergeArtifactV1.editableDerivedAssetId ?? 'derived_hdr_app_server_001',
    dryRun: false,
    mutates: true,
    outputArtifacts: [sampleHdrMergeArtifactV1.outputArtifact],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: sampleHdrMergeArtifactV1.warningCodes,
  }),
  commandType: 'computationalMerge.createHdr',
  familyLabel: 'HDR',
  manifestValue: sampleComputationalMergeAppServerToolManifestV1,
};

const commandBus = new ComputationalMergeAppServerCommandBusHarness(hdrCommandBusConfig);
const dryRun = commandBus.execute(
  'computationalmerge.hdr.dry_run_command',
  sampleComputationalMergeHdrCommandEnvelopeV1,
);
if (dryRun.kind !== 'dry_run') {
  throw new Error('Expected HDR app-server dry-run tool to return dry_run result.');
}

const acceptedApplyCommand = computationalMergeCommandEnvelopeV1Schema.parse({
  ...sampleComputationalMergeHdrCommandEnvelopeV1,
  approval: {
    approvalClass: 'edit_apply',
    reason: 'User approved applying accepted HDR merge dry-run plan.',
    state: 'approved',
  },
  commandId: 'command_merge_hdr_apply_sample',
  correlationId: 'corr_merge_hdr_apply_sample',
  dryRun: false,
  parameters: {
    ...sampleComputationalMergeHdrCommandEnvelopeV1.parameters,
    acceptedDryRunPlanHash: sampleHdrMergeArtifactV1.dryRun.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRun.dryRunResult.mergePlan.planId,
  },
});
const apply = commandBus.execute('computationalmerge.hdr.apply_command', acceptedApplyCommand);
if (apply.kind !== 'apply') {
  throw new Error('Expected HDR app-server apply tool to return apply result.');
}

expectThrows('HDR dry-run tool with panorama command', () =>
  commandBus.execute('computationalmerge.hdr.dry_run_command', sampleComputationalMergeCommandEnvelopeV1),
);

expectThrows('HDR dry-run tool with apply command', () =>
  commandBus.execute('computationalmerge.hdr.dry_run_command', acceptedApplyCommand),
);

expectThrows('HDR apply tool before accepted dry-run', () =>
  new ComputationalMergeAppServerCommandBusHarness(hdrCommandBusConfig).execute(
    'computationalmerge.hdr.apply_command',
    acceptedApplyCommand,
  ),
);

expectThrows('HDR apply tool with mismatched dry-run plan hash', () =>
  commandBus.execute('computationalmerge.hdr.apply_command', {
    ...acceptedApplyCommand,
    parameters: {
      ...acceptedApplyCommand.parameters,
      acceptedDryRunPlanHash: 'sha256:mismatched-hdr-plan',
    },
  }),
);

console.log('HDR app-server command bus ok');
