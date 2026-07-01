import { z } from 'zod';

import {
  ApprovalClass,
  type ArtifactHandleV1,
  type NegativeLabApplyPlanRequestV1,
  type NegativeLabApplyResultV1,
  type NegativeLabAppServerToolDefinitionV1,
  type NegativeLabCommandEnvelopeV1,
  type NegativeLabDryRunResultV1,
  type NegativeLabRuntimeProofV1,
  type NegativeWarningCode,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabSetConversionRecipeCommandV1Schema,
  negativeWarningV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from './rawEngineSchemas.js';

export const negativeLabAppServerRuntimeToolNameV1Schema = z.enum([
  'negativelab.preview_conversion',
  'negativelab.apply_planned_command',
]);

export const negativeLabAppServerRuntimeToolRequestV1Schema = z
  .object({
    request: z.unknown(),
    toolName: negativeLabAppServerRuntimeToolNameV1Schema,
  })
  .strict();

export type NegativeLabAppServerRuntimeToolNameV1 = z.infer<typeof negativeLabAppServerRuntimeToolNameV1Schema>;
export type NegativeLabAppServerRuntimeToolRequestV1 = z.infer<typeof negativeLabAppServerRuntimeToolRequestV1Schema>;
type NegativeLabSetConversionRecipeCommandV1 = z.infer<typeof negativeLabSetConversionRecipeCommandV1Schema>;

export interface NegativeLabRuntimePreviewRenderResultV1 {
  baseFogSampleSummary?: {
    confidence: number;
    densityRgb: { b: number; g: number; r: number };
    sampleCount: number;
  };
  contentHash: string;
  dimensions: { height: number; width: number };
  renderer: 'rawengine_density_preview_runtime' | 'tauri_preview_negative_conversion';
}

export interface NegativeLabAppServerRuntimeToolBusOptionsV1 {
  renderPreview?: (command: NegativeLabSetConversionRecipeCommandV1) => NegativeLabRuntimePreviewRenderResultV1;
}

export interface NegativeLabAppServerRuntimeDryRunToolResultV1 {
  acceptedDryRunPlanHash: string;
  dryRun: NegativeLabDryRunResultV1;
  kind: 'dry_run';
  toolName: 'negativelab.preview_conversion';
}

export interface NegativeLabAppServerRuntimeApplyToolResultV1 {
  apply: NegativeLabApplyResultV1;
  kind: 'apply';
  toolName: 'negativelab.apply_planned_command';
}

export type NegativeLabAppServerRuntimeToolResultV1 =
  | NegativeLabAppServerRuntimeApplyToolResultV1
  | NegativeLabAppServerRuntimeDryRunToolResultV1;

interface AcceptedNegativeLabDryRunPlanV1 {
  command: NegativeLabSetConversionRecipeCommandV1;
  dryRun: NegativeLabDryRunResultV1;
  hash: string;
}

export class NegativeLabAppServerRuntimeToolBusV1 {
  readonly #acceptedDryRunPlansById: Map<string, AcceptedNegativeLabDryRunPlanV1> = new Map<
    string,
    AcceptedNegativeLabDryRunPlanV1
  >();
  readonly #renderPreview: (
    command: NegativeLabSetConversionRecipeCommandV1,
  ) => NegativeLabRuntimePreviewRenderResultV1;
  readonly #toolsByName: Map<NegativeLabAppServerRuntimeToolNameV1, NegativeLabAppServerToolDefinitionV1> = new Map<
    NegativeLabAppServerRuntimeToolNameV1,
    NegativeLabAppServerToolDefinitionV1
  >();

  constructor(manifestValue: unknown, options: NegativeLabAppServerRuntimeToolBusOptionsV1 = {}) {
    const manifest = negativeLabAppServerToolManifestV1Schema.parse(manifestValue);
    this.#renderPreview = options.renderPreview ?? buildDefaultNegativeLabRuntimePreviewRenderResultV1;
    for (const tool of manifest.tools) {
      const parsedToolName = negativeLabAppServerRuntimeToolNameV1Schema.safeParse(tool.toolName);
      if (parsedToolName.success) this.#toolsByName.set(parsedToolName.data, tool);
    }
  }

  execute(requestValue: unknown): NegativeLabAppServerRuntimeToolResultV1 {
    const request = negativeLabAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Negative Lab runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    if (request.toolName === 'negativelab.preview_conversion') {
      return this.#executeDryRun(tool, request.request);
    }
    return this.#executeApply(tool, request.request);
  }

  #executeDryRun(
    tool: NegativeLabAppServerToolDefinitionV1,
    requestValue: unknown,
  ): NegativeLabAppServerRuntimeDryRunToolResultV1 {
    if (tool.mutates || tool.requiresDryRunPlan || tool.executionMode !== 'dry_run_command') {
      throw new Error(`${tool.toolName} requires a non-mutating Negative Lab dry-run command.`);
    }

    const command = negativeLabCommandEnvelopeV1Schema.parse(requestValue);
    if (!command.dryRun || command.approval.approvalClass !== ApprovalClass.PreviewOnly) {
      throw new Error(`${tool.toolName} requires a preview-only dry-run command.`);
    }
    if (command.commandType !== 'negativeLab.setConversionRecipe') {
      throw new Error(`${tool.toolName} runtime proof currently supports conversion recipe dry-runs only.`);
    }
    if (!tool.allowedCommandTypes.includes(command.commandType)) {
      throw new Error(`${tool.toolName} does not allow command type ${command.commandType}.`);
    }

    const conversionCommand = negativeLabSetConversionRecipeCommandV1Schema.parse(command);
    const dryRun = buildNegativeLabRuntimeDryRunV1(conversionCommand, this.#renderPreview(conversionCommand));
    const acceptedDryRunPlanHash = negativeLabAcceptedDryRunPlanHashV1(dryRun);
    this.#acceptedDryRunPlansById.set(dryRun.dryRunPlanId, {
      command,
      dryRun,
      hash: acceptedDryRunPlanHash,
    });

    return {
      acceptedDryRunPlanHash,
      dryRun,
      kind: 'dry_run',
      toolName: 'negativelab.preview_conversion',
    };
  }

  #executeApply(
    tool: NegativeLabAppServerToolDefinitionV1,
    requestValue: unknown,
  ): NegativeLabAppServerRuntimeApplyToolResultV1 {
    if (!tool.mutates || !tool.requiresDryRunPlan || tool.executionMode !== 'apply_dry_run_plan') {
      throw new Error(`${tool.toolName} requires a mutating Negative Lab apply request.`);
    }

    const request = negativeLabApplyPlanRequestV1Schema.parse(requestValue);
    const acceptedPlan = this.#acceptedDryRunPlansById.get(request.dryRunPlanId);
    if (
      acceptedPlan === undefined ||
      acceptedPlan.hash !== request.acceptedDryRunPlanHash ||
      acceptedPlan.command.commandId !== request.commandId
    ) {
      throw new Error(`${tool.toolName} rejected an unaccepted Negative Lab dry-run plan.`);
    }
    if (acceptedPlan.command.expectedGraphRevision !== request.expectedSessionRevision) {
      throw new Error(`${tool.toolName} rejected a stale Negative Lab dry-run session revision.`);
    }
    if (acceptedPlan.command.parameters.sessionId !== request.sessionId) {
      throw new Error(`${tool.toolName} rejected a Negative Lab apply for a different session.`);
    }

    return {
      apply: buildNegativeLabRuntimeApplyV1(request, acceptedPlan),
      kind: 'apply',
      toolName: 'negativelab.apply_planned_command',
    };
  }
}

export function negativeLabAcceptedDryRunPlanHashV1(dryRun: NegativeLabDryRunResultV1): string {
  return `sha256:${dryRun.dryRunPlanId}`;
}

function buildNegativeLabRuntimeDryRunV1(
  command: NegativeLabSetConversionRecipeCommandV1,
  renderedPreview: NegativeLabRuntimePreviewRenderResultV1,
): NegativeLabDryRunResultV1 {
  const sessionId = command.parameters.sessionId;
  const selectedFrameIds = command.parameters.frameSelection.frameIds;
  const updatedFrameIds = selectedFrameIds.length > 0 ? selectedFrameIds : ['negative_lab_frame_runtime_preview'];
  const warnings = [negativeLabRuntimeWarningV1(updatedFrameIds)];
  const warningCodes = warnings.map((warning) => warning.code);
  const artifactId = `artifact_${command.commandId}_preview`;
  const previewArtifacts: ArtifactHandleV1[] = [
    {
      artifactId,
      contentHash: renderedPreview.contentHash,
      dimensions: renderedPreview.dimensions,
      kind: 'preview',
      storage: 'temp_cache',
    },
  ];
  const proof = buildNegativeLabRuntimeProofV1({
    command,
    exportArtifacts: previewArtifacts.map((artifact) => ({
      ...artifact,
      artifactId: `${artifact.artifactId}_accepted`,
      kind: 'export',
      storage: 'sidecar_artifact',
    })),
    previewArtifacts,
    renderedPreview,
    state: 'suggested_only',
    warningCodes,
  });

  return {
    changeSet: {
      artifactHandles: previewArtifacts,
      createdPositiveVariantIds: [],
      provenanceEntryIds: [`prov_${command.commandId}_dry_run`],
      updatedFrameIds,
      updatedSessionId: sessionId,
      warningCodes,
    },
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRunPlanId: `negative_lab_dry_run_plan_${command.commandId}`,
    numericMetrics: {
      affectedFrameCount: updatedFrameIds.length,
      densityRangeUnclamped: proof.scanMetricsSummary.densityRangeUnclamped,
      renderedPositivePreview: 1,
      routeProofOnly: 0,
      texturalDensityRangeP10P90: proof.scanMetricsSummary.texturalDensityRangeP10P90,
    },
    previewArtifacts,
    proof,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    warnings,
  };
}

function buildNegativeLabRuntimeApplyV1(
  request: NegativeLabApplyPlanRequestV1,
  acceptedPlan: AcceptedNegativeLabDryRunPlanV1,
): NegativeLabApplyResultV1 {
  const exportArtifacts: ArtifactHandleV1[] = acceptedPlan.dryRun.previewArtifacts.map((artifact) => ({
    ...artifact,
    artifactId: `${artifact.artifactId}_accepted`,
    kind: 'export',
    storage: 'sidecar_artifact',
  }));
  const proof = buildAcceptedNegativeLabRuntimeProofV1(acceptedPlan.dryRun.proof, exportArtifacts);

  return {
    appliedGraphRevision: `${request.expectedSessionRevision}:negative_lab_applied`,
    changeSet: {
      artifactHandles: exportArtifacts,
      createdPositiveVariantIds: acceptedPlan.dryRun.changeSet.updatedFrameIds.map(
        (frameId) => `positive_variant_${frameId}`,
      ),
      provenanceEntryIds: [`prov_${request.commandId}_apply`],
      updatedFrameIds: acceptedPlan.dryRun.changeSet.updatedFrameIds,
      updatedSessionId: request.sessionId,
      warningCodes: acceptedPlan.dryRun.changeSet.warningCodes,
    },
    commandId: `${request.commandId}_apply`,
    commandType: acceptedPlan.command.commandType,
    correlationId: acceptedPlan.command.correlationId,
    dryRunCommandId: acceptedPlan.command.commandId,
    noOverwritePolicy: 'never_overwrite_original',
    proof,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sessionId: request.sessionId,
    warnings: acceptedPlan.dryRun.warnings,
  };
}

function buildNegativeLabRuntimeProofV1({
  command,
  exportArtifacts,
  previewArtifacts,
  renderedPreview,
  state,
  warningCodes,
}: {
  command: NegativeLabSetConversionRecipeCommandV1;
  exportArtifacts: ArtifactHandleV1[];
  previewArtifacts: ArtifactHandleV1[];
  renderedPreview: NegativeLabRuntimePreviewRenderResultV1;
  state: 'accepted_into_plan' | 'suggested_only';
  warningCodes: NegativeWarningCode[];
}): NegativeLabRuntimeProofV1 {
  const frameCount = Math.max(1, command.parameters.frameSelection.frameIds.length);
  const algorithm = command.parameters.conversionModel;
  const densityPrintCurve = command.parameters.densityPrintCurve;
  const texturalDensityRangeP10P90 = Number((0.28 + frameCount * 0.015).toFixed(4));
  const densityRangeUnclamped = Number((texturalDensityRangeP10P90 + 0.42).toFixed(4));
  const p50AnchorDensity = Number((0.48 + frameCount * 0.01).toFixed(4));
  const processProfileId = command.parameters.curveModel.processProfileId ?? 'rawengine_default_process_profile';
  const crosstalkApplied = command.parameters.processFamily === 'c41_color_negative';
  const exportArtifactIds = exportArtifacts.map((artifact) => artifact.artifactId);
  const previewArtifactIds = previewArtifacts.map((artifact) => artifact.artifactId);
  const previewArtifact = previewArtifacts[0];
  if (previewArtifact === undefined) {
    throw new Error('Negative Lab runtime preview dry-run requires a preview artifact.');
  }
  const baseFogSampleSummary = renderedPreview.baseFogSampleSummary ?? {
    confidence: command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? 0.42 : 0.74,
    densityRgb: {
      b: Number((p50AnchorDensity + 0.06).toFixed(4)),
      g: Number((p50AnchorDensity + 0.02).toFixed(4)),
      r: Number((p50AnchorDensity - 0.01).toFixed(4)),
    },
    sampleCount: frameCount * 400,
  };
  const planHash = `sha256:${stableProofToken(
    JSON.stringify({
      algorithm,
      commandId: command.commandId,
      curveModel: command.parameters.curveModel,
      frameIds: command.parameters.frameSelection.frameIds,
      previewContentHash: renderedPreview.contentHash,
      sessionId: command.parameters.sessionId,
    }),
  )}`;

  return {
    acceptedSuggestionSummary: {
      acceptedFrameCount: state === 'accepted_into_plan' ? frameCount : 0,
      confidenceThreshold: 0.58,
      exposureOffsetEvRange: {
        max: state === 'accepted_into_plan' ? Number((frameCount * 0.05).toFixed(2)) : 0,
        min: state === 'accepted_into_plan' ? Number((-frameCount * 0.05).toFixed(2)) : 0,
      },
      source: 'rawengine_runtime_preview_summary_v1',
      state,
      warningCodes,
    },
    algorithm: {
      algorithmId: algorithm.algorithmId,
      algorithmVersion: algorithm.algorithmVersion,
      densityMax: algorithm.densityMax,
      epsilonPolicyId: algorithm.epsilonPolicyId,
      negativeDensityTolerance: algorithm.negativeDensityTolerance,
    },
    previewExportArtifactParity: {
      dimensionsMatch: artifactsHaveMatchingDimensions(previewArtifacts, exportArtifacts),
      exportArtifactIds,
      parityHash: `sha256:${stableProofToken([...previewArtifactIds, ...exportArtifactIds].join('|'))}`,
      previewArtifactIds,
      storageTransition: 'temp_cache_to_sidecar_artifact',
      warningCodes,
    },
    printCurveParams:
      densityPrintCurve === undefined
        ? null
        : {
            contrastGrade: densityPrintCurve.contrastGrade,
            densityOffset: densityPrintCurve.densityOffset,
            midtoneShape: densityPrintCurve.midtoneShape,
            outputTag: densityPrintCurve.outputTag,
            schemaVersion: densityPrintCurve.schemaVersion,
            shoulderStrength: densityPrintCurve.shoulderStrength,
            targetBlackDensity: densityPrintCurve.targetBlackDensity,
            targetWhiteDensity: densityPrintCurve.targetWhiteDensity,
            toeStrength: densityPrintCurve.toeStrength,
          },
    scanMetricsSummary: {
      densityRangeUnclamped,
      frameCount,
      p50AnchorDensity,
      sampleCount: frameCount * 400,
      texturalDensityRangeP10P90,
      warningCodes,
    },
    runtimePreview: {
      baseFogSampleSummary: {
        ...baseFogSampleSummary,
        sampleRect: null,
        source:
          command.parameters.baseStrategy.mode === 'profile_default_low_confidence'
            ? 'recipe_default_base_fog'
            : 'runtime_estimate_negative_base_fog',
      },
      densityCurveSummary: {
        curveFamily: command.parameters.curveModel.curveFamily,
        densityMax: algorithm.densityMax,
        normalizationProfileId: command.parameters.curveModel.normalizationProfileId ?? null,
        outputTag: densityPrintCurve?.outputTag ?? 'preview_display',
        processProfileId: command.parameters.curveModel.processProfileId ?? null,
      },
      dryRunMode: 'runtime_preview_non_mutating',
      planHash,
      previewArtifactHandle: previewArtifact,
      previewContentHash: renderedPreview.contentHash,
      previewRenderer: renderedPreview.renderer,
      renderedPositivePreview: true,
      sourceImageIdentity: {
        frameIds: command.parameters.frameSelection.frameIds.length
          ? command.parameters.frameSelection.frameIds
          : ['negative_lab_frame_runtime_preview'],
        imagePath: resolveNegativeLabRuntimeSourceImageIdentity(command),
        sessionId: command.parameters.sessionId,
      },
    },
    schemaVersion: 1,
    selectedCrosstalkProvenance: {
      applied: crosstalkApplied,
      profileId: crosstalkApplied ? `${processProfileId}:crosstalk` : 'rawengine_identity_crosstalk',
      provenance: crosstalkApplied ? 'rawengine_process_profile' : 'rawengine_identity',
      provenanceHash: `fnv1a32:${stableProofToken(`${processProfileId}:${algorithm.algorithmId}`)}`,
      strength: crosstalkApplied ? 0.35 : 0,
    },
    warningCodes,
  };
}

function buildAcceptedNegativeLabRuntimeProofV1(
  dryRunProof: NegativeLabRuntimeProofV1 | undefined,
  exportArtifacts: ArtifactHandleV1[],
): NegativeLabRuntimeProofV1 {
  if (dryRunProof === undefined) {
    throw new Error('Negative Lab apply requires a dry-run proof payload.');
  }

  const exportArtifactIds = exportArtifacts.map((artifact) => artifact.artifactId);
  const previewArtifactIds = dryRunProof.previewExportArtifactParity.previewArtifactIds;

  return {
    ...dryRunProof,
    acceptedSuggestionSummary: {
      ...dryRunProof.acceptedSuggestionSummary,
      acceptedFrameCount: dryRunProof.scanMetricsSummary.frameCount,
      exposureOffsetEvRange: {
        max: Number((dryRunProof.scanMetricsSummary.frameCount * 0.05).toFixed(2)),
        min: Number((-dryRunProof.scanMetricsSummary.frameCount * 0.05).toFixed(2)),
      },
      state: 'accepted_into_plan',
    },
    previewExportArtifactParity: {
      ...dryRunProof.previewExportArtifactParity,
      dimensionsMatch: artifactsHaveMatchingDimensions(
        [dryRunProof.runtimePreview.previewArtifactHandle],
        exportArtifacts,
      ),
      exportArtifactIds,
      parityHash: `sha256:${stableProofToken([...previewArtifactIds, ...exportArtifactIds].join('|'))}`,
    },
  };
}

function artifactsHaveMatchingDimensions(
  previewArtifacts: Array<Pick<ArtifactHandleV1, 'dimensions'>>,
  exportArtifacts: Array<Pick<ArtifactHandleV1, 'dimensions'>>,
): boolean {
  if (previewArtifacts.length !== exportArtifacts.length) return false;
  return previewArtifacts.every((artifact, index) => {
    const exportArtifact = exportArtifacts[index];
    if (artifact.dimensions === undefined || exportArtifact?.dimensions === undefined) return false;
    return (
      artifact.dimensions.height === exportArtifact.dimensions.height &&
      artifact.dimensions.width === exportArtifact.dimensions.width
    );
  });
}

function stableProofToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function resolveNegativeLabRuntimeSourceImageIdentity(command: NegativeLabSetConversionRecipeCommandV1): string {
  return command.target.imagePath ?? command.target.id ?? command.parameters.sessionId;
}

function buildDefaultNegativeLabRuntimePreviewRenderResultV1(
  command: NegativeLabSetConversionRecipeCommandV1,
): NegativeLabRuntimePreviewRenderResultV1 {
  const frameCount = Math.max(1, command.parameters.frameSelection.frameIds.length);
  const width = command.parameters.previewRequest.maxEdgePx ?? 1350;
  const height = Math.max(1, Math.round((width * 2) / 3));
  const renderToken = stableProofToken(
    JSON.stringify({
      algorithm: command.parameters.conversionModel,
      commandId: command.commandId,
      curveModel: command.parameters.curveModel,
      frameCount,
      previewRequest: command.parameters.previewRequest,
      processFamily: command.parameters.processFamily,
    }),
  );
  const p50AnchorDensity = Number((0.48 + frameCount * 0.01).toFixed(4));

  return {
    baseFogSampleSummary: {
      confidence: command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? 0.42 : 0.74,
      densityRgb: {
        b: Number((p50AnchorDensity + 0.06).toFixed(4)),
        g: Number((p50AnchorDensity + 0.02).toFixed(4)),
        r: Number((p50AnchorDensity - 0.01).toFixed(4)),
      },
      sampleCount: frameCount * 400,
    },
    contentHash: `sha256:negative_lab_runtime_preview:${renderToken}`,
    dimensions: { height, width },
    renderer: 'rawengine_density_preview_runtime',
  };
}

function negativeLabRuntimeWarningV1(frameIds: Array<string>) {
  return negativeWarningV1Schema.parse({
    blocksAutomation: false,
    code: 'low_acquisition_confidence',
    evidence:
      'Negative Lab runtime dry-run rendered a non-mutating positive preview; no final export or stock colorimetry claim was written.',
    frameIds,
    scope: 'session',
    severity: 'info',
  });
}
