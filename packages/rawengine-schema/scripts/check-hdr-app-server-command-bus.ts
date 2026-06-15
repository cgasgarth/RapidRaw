import { z } from 'zod';

import {
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type ComputationalMergeAppServerToolDefinitionV1,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDryRunResultV1,
  type ComputationalMergeMutationResultV1,
} from '../src/rawEngineSchemas.js';
import {
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeHdrCommandEnvelopeV1,
  sampleHdrMergeArtifactV1,
} from '../src/samplePayloads.js';

const HdrAppServerCommandBusResultSchema = z.discriminatedUnion('kind', [
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

class HdrAppServerCommandBus {
  readonly #acceptedDryRunPlanIds = new Set<string>();
  readonly #toolsByName = new Map<string, ComputationalMergeAppServerToolDefinitionV1>();

  constructor(manifestValue: unknown) {
    const manifest = computationalMergeAppServerToolManifestV1Schema.parse(manifestValue);
    for (const tool of manifest.tools.filter((candidateTool) =>
      candidateTool.allowedCommandTypes.includes('computationalMerge.createHdr'),
    )) {
      this.#toolsByName.set(tool.toolName, tool);
    }
  }

  execute(toolName: string, commandValue: unknown) {
    const tool = this.#toolsByName.get(toolName);
    if (tool === undefined) {
      throw new Error(`HDR app-server command bus has no registered tool named ${toolName}.`);
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

    this.#acceptedDryRunPlanIds.add(dryRunResult.mergePlan.planId);
    return HdrAppServerCommandBusResultSchema.parse({
      dryRunResult,
      kind: 'dry_run',
      toolName: tool.toolName,
    });
  }

  #executeApply(tool: ComputationalMergeAppServerToolDefinitionV1, command: ComputationalMergeCommandEnvelopeV1) {
    if (command.dryRun) {
      throw new Error(`${tool.toolName} requires an apply command envelope.`);
    }

    if (command.commandType !== 'computationalMerge.createHdr') {
      throw new Error(`${tool.toolName} only applies HDR commands.`);
    }

    const acceptedPlanId = command.parameters.acceptedDryRunPlanId;
    if (acceptedPlanId === undefined || !this.#acceptedDryRunPlanIds.has(acceptedPlanId)) {
      throw new Error(`${tool.toolName} rejected unaccepted dry-run plan ${String(acceptedPlanId)}.`);
    }

    const mutationResult = computationalMergeMutationResultV1Schema.parse({
      appliedGraphRevision: 'graph_rev_48_hdr_apply',
      changedNodeIds: ['node_merge_hdr_app_server_001'],
      commandId: command.commandId,
      commandType: command.commandType,
      correlationId: command.correlationId,
      derivedAssetId: sampleHdrMergeArtifactV1.editableDerivedAssetId,
      dryRun: false,
      mutates: true,
      outputArtifacts: [sampleHdrMergeArtifactV1.outputArtifact],
      schemaVersion: command.schemaVersion,
      sourceGraphRevision: command.expectedGraphRevision,
      undoRevision: command.expectedGraphRevision,
      warnings: sampleHdrMergeArtifactV1.warningCodes,
    });

    return HdrAppServerCommandBusResultSchema.parse({
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

const commandBus = new HdrAppServerCommandBus(sampleComputationalMergeAppServerToolManifestV1);
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
  new HdrAppServerCommandBus(sampleComputationalMergeAppServerToolManifestV1).execute(
    'computationalmerge.hdr.apply_command',
    acceptedApplyCommand,
  ),
);

console.log('HDR app-server command bus ok');
