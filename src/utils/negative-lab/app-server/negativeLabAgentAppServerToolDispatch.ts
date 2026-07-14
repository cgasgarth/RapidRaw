import { invoke } from '@tauri-apps/api/core';
import {
  type AcceptedNegativeLabDryRunPlanV1,
  NegativeLabAppServerRuntimeToolBusV1,
  type NegativeLabAppServerRuntimeToolResultV1,
} from '../../../../packages/rawengine-schema/src/negativeLabAppServerRuntime';
import {
  ApprovalClass,
  type NegativeLabApplyPlanRequestV1,
  type NegativeLabApplyResultV1,
  type NegativeLabAppServerToolManifestV1,
  type NegativeLabDensityBoundsReceiptV1,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas';
import {
  type NegativeLabSavedPositiveHandoff,
  negativeConversionSavedPositiveHandoffsSchema,
} from '../../../schemas/negative-lab/negativeLabPresetCatalogSchemas';
import { Invokes } from '../../../tauri/commands';

export const NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME = 'negativelab.preview_conversion';
export const NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME = 'negativelab.apply_planned_command';

export const NEGATIVE_LAB_AGENT_TOOL_MANIFEST: NegativeLabAppServerToolManifestV1 = {
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  serverRuntime: 'openai_app_server',
  tools: [
    {
      allowedCommandTypes: ['negativeLab.setConversionRecipe'],
      approvalClass: ApprovalClass.PreviewOnly,
      auditEvents: ['negative_lab_dry_run_requested', 'negative_lab_dry_run_completed'],
      description: 'Preview a Negative Lab command and return a non-mutating dry-run plan.',
      executionMode: 'dry_run_command',
      inputSchemaName: 'NegativeLabCommandEnvelopeV1',
      localOnly: true,
      mutates: false,
      outputSchemaName: 'NegativeLabDryRunResultV1',
      recordsProvenance: true,
      requiresDryRunPlan: false,
      returnsArtifactHandles: true,
      toolName: NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
    },
    {
      allowedCommandTypes: ['negativeLab.setConversionRecipe'],
      approvalClass: ApprovalClass.EditApply,
      auditEvents: ['negative_lab_apply_requested', 'negative_lab_apply_completed'],
      description: 'Apply an accepted Negative Lab dry-run plan after local operator approval.',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName: 'NegativeLabApplyPlanRequestV1',
      localOnly: true,
      mutates: true,
      outputSchemaName: 'NegativeLabApplyResultV1',
      recordsProvenance: true,
      requiresDryRunPlan: true,
      returnsArtifactHandles: true,
      toolName: NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
    },
  ],
};

const negativeLabNativeApplyExecutor = async (
  request: NegativeLabApplyPlanRequestV1,
  acceptedPlan: Readonly<AcceptedNegativeLabDryRunPlanV1>,
): Promise<NegativeLabApplyResultV1> => {
  const nativeCommit = acceptedPlan.command.parameters.nativeCommit;
  if (nativeCommit === undefined) {
    throw new Error(
      `${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} requires a nativeCommit payload from the accepted preview recipe.`,
    );
  }
  const targetPath = acceptedPlan.command.target.imagePath;
  if (targetPath !== undefined && !nativeCommit.paths.includes(targetPath)) {
    throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} rejected a source outside the accepted command target.`);
  }
  const uniquePaths = new Set(nativeCommit.paths);
  if (uniquePaths.size !== nativeCommit.paths.length) {
    throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} rejected duplicate native source paths.`);
  }

  const nativeOptions = {
    ...(nativeCommit.options ?? {}),
    acceptedDryRunPlanHash: request.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: request.dryRunPlanId,
  };
  const rawHandoffs = await invoke<unknown>(Invokes.ConvertNegatives, {
    options: nativeOptions,
    params: nativeCommit.params,
    paths: nativeCommit.paths,
  });
  const handoffs = negativeConversionSavedPositiveHandoffsSchema.parse(rawHandoffs);
  if (handoffs.length !== nativeCommit.paths.length) {
    throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} native save returned an incomplete source set.`);
  }

  return buildNegativeLabNativeApplyResultV1({ acceptedPlan, handoffs, request });
};

export const buildNegativeLabNativeApplyResultV1 = ({
  acceptedPlan,
  handoffs,
  request,
}: {
  acceptedPlan: Readonly<AcceptedNegativeLabDryRunPlanV1>;
  handoffs: ReadonlyArray<NegativeLabSavedPositiveHandoff>;
  request: NegativeLabApplyPlanRequestV1;
}): NegativeLabApplyResultV1 => {
  const positiveOutputReceipts = handoffs.map((handoff) => {
    if (handoff.sourcePath === handoff.outputPath || handoff.sourceImageRef === handoff.outputPath) {
      throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} rejected a native output that overwrites its source.`);
    }
    if (handoff.sourcePath !== handoff.sourceImageRef) {
      throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} rejected a native source identity mismatch.`);
    }
    const boundsReceipt = mapNativeBoundsReceipt(handoff.densityNormalizationMetrics?.boundsReceipt);
    return {
      acceptedDryRunPlanHash: request.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: request.dryRunPlanId,
      boundsReceipt,
      conversionBundleContentHash: `sha256:${handoff.replayPlanHash}`,
      conversionBundlePath: handoff.conversionBundlePath ?? handoff.sidecarPath,
      dimensions: handoff.dimensions,
      outputArtifact: {
        artifactId: handoff.outputArtifactId,
        contentHash: `sha256:${handoff.outputHash}`,
        dimensions: handoff.dimensions,
        kind: 'export' as const,
        storage: 'export_path' as const,
      },
      outputPath: handoff.outputPath,
      path: handoff.path,
      positiveVariantId: handoff.positiveVariantId,
      provenanceEntryIds: [`negative_lab_native_${handoff.positiveVariantId}`],
      replayPlanHash: `sha256:${handoff.replayPlanHash}`,
      sidecarPath: handoff.sidecarPath,
      sourceImageRef: handoff.sourceImageRef,
      sourcePath: handoff.sourcePath,
      state: 'saved' as const,
    };
  });
  const warningCodes = acceptedPlan.dryRun.warnings.map((warning) => warning.code);
  return {
    appliedGraphRevision: `${request.expectedSessionRevision}:negative_lab_applied`,
    changeSet: {
      artifactHandles: positiveOutputReceipts.map((receipt) => receipt.outputArtifact),
      createdPositiveVariantIds: positiveOutputReceipts.map((receipt) => receipt.positiveVariantId),
      provenanceEntryIds: positiveOutputReceipts.flatMap((receipt) => receipt.provenanceEntryIds),
      updatedFrameIds: acceptedPlan.dryRun.changeSet.updatedFrameIds,
      updatedSessionId: request.sessionId,
      warningCodes,
    },
    commandId: `${request.commandId}_apply`,
    commandType: acceptedPlan.command.commandType,
    correlationId: acceptedPlan.command.correlationId,
    dryRunCommandId: acceptedPlan.command.commandId,
    noOverwritePolicy: 'never_overwrite_original',
    positiveOutputReceipts,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sessionId: request.sessionId,
    warnings: acceptedPlan.dryRun.warnings,
  };
};

const mapNativeBoundsReceipt = (receipt: unknown): NegativeLabDensityBoundsReceiptV1 => {
  if (receipt === undefined || typeof receipt !== 'object' || receipt === null) {
    throw new Error(`${NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME} native save returned no density bounds receipt.`);
  }
  const source = receipt as {
    algorithmId: NegativeLabDensityBoundsReceiptV1['algorithmId'];
    analysisBuffer: number;
    analysisRect: NegativeLabDensityBoundsReceiptV1['analysisRect'];
    baseBounds: {
      axisBounds: NegativeLabDensityBoundsReceiptV1['baseBounds']['axisBounds'];
      channelBounds: {
        b: { max: number; min: number };
        g: { max: number; min: number };
        r: { max: number; min: number };
      };
    };
    baseFogProvenance: NegativeLabDensityBoundsReceiptV1['baseFogProvenance'];
    colorRangeClip: number;
    finalBounds: {
      axisBounds: NegativeLabDensityBoundsReceiptV1['finalBounds']['axisBounds'];
      channelBounds: {
        b: { max: number; min: number };
        g: { max: number; min: number };
        r: { max: number; min: number };
      };
    };
    lumaRangeClip: number;
    schemaVersion: 1;
    warningCodes: NegativeLabDensityBoundsReceiptV1['warningCodes'];
  };
  return {
    algorithmId: source.algorithmId,
    analysisBuffer: source.analysisBuffer,
    analysisRect: source.analysisRect,
    baseBounds: {
      axisBounds: source.baseBounds.axisBounds,
      channelBounds: {
        blue: source.baseBounds.channelBounds.b,
        green: source.baseBounds.channelBounds.g,
        red: source.baseBounds.channelBounds.r,
      },
    },
    baseFogProvenance: source.baseFogProvenance,
    colorRangeClip: source.colorRangeClip,
    finalBounds: {
      axisBounds: source.finalBounds.axisBounds,
      channelBounds: {
        blue: source.finalBounds.channelBounds.b,
        green: source.finalBounds.channelBounds.g,
        red: source.finalBounds.channelBounds.r,
      },
    },
    lumaRangeClip: source.lumaRangeClip,
    schemaVersion: source.schemaVersion,
    warningCodes: source.warningCodes,
  };
};

let negativeLabAgentToolBus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST, {
  applyNative: negativeLabNativeApplyExecutor,
});

export const resetNegativeLabAgentAppServerToolDispatchForTests = (): void => {
  negativeLabAgentToolBus = new NegativeLabAppServerRuntimeToolBusV1(NEGATIVE_LAB_AGENT_TOOL_MANIFEST, {
    applyNative: negativeLabNativeApplyExecutor,
  });
};

export const dispatchNegativeLabAgentAppServerTool = (request: {
  arguments: unknown;
  runtimeToolName: string;
}): NegativeLabAppServerRuntimeToolResultV1 => {
  if (
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME &&
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME
  ) {
    throw new Error(`Unsupported Negative Lab agent tool: ${request.runtimeToolName}`);
  }

  return negativeLabAgentToolBus.execute({
    request: request.arguments,
    toolName: request.runtimeToolName,
  });
};

export const dispatchNegativeLabAgentAppServerToolAsync = async (request: {
  arguments: unknown;
  runtimeToolName: string;
}): Promise<NegativeLabAppServerRuntimeToolResultV1> => {
  if (
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME &&
    request.runtimeToolName !== NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME
  ) {
    throw new Error(`Unsupported Negative Lab agent tool: ${request.runtimeToolName}`);
  }

  return negativeLabAgentToolBus.executeAsync({
    request: request.arguments,
    toolName: request.runtimeToolName,
  });
};
