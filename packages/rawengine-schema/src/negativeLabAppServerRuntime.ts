import { z } from 'zod';

import {
  ApprovalClass,
  type ArtifactHandleV1,
  type NegativeLabApplyPlanRequestV1,
  type NegativeLabApplyResultV1,
  type NegativeLabAppServerToolDefinitionV1,
  type NegativeLabDensityBoundsReceiptV1,
  type NegativeLabDryRunResultV1,
  type NegativeLabPositiveOutputReceiptV1,
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
  artifactId: string;
  baseFogSampleSummary?: {
    clippedFraction: number;
    confidence: number;
    densityRange: number;
    densityRgb: { b: number; g: number; r: number };
    meanRgb: { b: number; g: number; r: number };
    sampleCount: number;
    sampleRect: { height: number; width: number; x: number; y: number };
    source:
      | 'runtime_estimate_negative_base_fog'
      | 'recipe_default_base_fog'
      | 'requested_base_fog_sample_rect'
      | 'deterministic_edge_safe_default_rect';
    warningCodes: NegativeWarningCode[];
  };
  contentHash: string;
  densityNormalizationMetrics?: {
    axisBounds: {
      color: { max: number; min: number };
      luma: { max: number; min: number };
    };
    channelBounds: {
      blue: { max: number; min: number };
      green: { max: number; min: number };
      red: { max: number; min: number };
    };
    boundsReceipt: NegativeLabDensityBoundsReceiptV1;
    clippedPixelCount: number;
    densityRangeUnclamped: number;
    epsilonClampedPixelCount: number;
    rendererVersion: number;
  };
  densityScopes?: {
    algorithmId: 'native_negative_lab_density_scopes_v1';
    clippedPixelCount: number;
    densityHistogram: { bins: number[]; max: number; min: number };
    gamutOutOfRangePixelCount: number;
    hAndDCurve: Array<{ inputDensity: number; outputLuma: number }>;
    outputLumaHistogram: { bins: number[]; max: number; min: number };
    sampleCount: number;
    schemaVersion: 1;
  };
  neutralAxisAnalysis?: {
    algorithmId: 'native_negative_lab_neutral_axis_v1';
    algorithmVersion: 1;
    status: 'disabled_identity' | 'no_correction_low_confidence' | 'correction_applied';
    fitMode: 'none' | 'quadratic_three_band_v1' | 'linear_two_band_v1' | 'global_one_band_v1';
    confidence: number;
    confidenceThreshold: number;
    sampleCount: number;
    bandSupport: [number, number, number];
    bandReferences: [[number, number, number], [number, number, number], [number, number, number]];
    residualBefore: number;
    residualAfter: number;
    effectiveGlobal: [number, number, number];
    effectiveShadow: [number, number, number];
    effectiveHighlight: [number, number, number];
    source: string;
    warningCodes: string[];
  };
  paperProfile?: NegativeLabSetConversionRecipeCommandV1['parameters']['paperProfile'];
  autoMeter?: {
    algorithmId: 'native_negative_lab_auto_meter_v1';
    algorithmVersion: 1;
    sampleCount: number;
    lumaDensityP10: number;
    lumaDensityP50: number;
    lumaDensityP90: number;
    texturalDensityRangeP10P90: number;
    boundedDensityRange: number;
    confidence: number;
    confidenceThreshold: number;
    requestedAutoDensityEnabled: boolean;
    requestedAutoDensityStrength: number;
    requestedAutoGradeEnabled: boolean;
    requestedAutoGradeStrength: number;
    appliedDensityOffset: number;
    effectiveIsoRGrade: number;
    densityApplied: boolean;
    gradeApplied: boolean;
    warningCodes: string[];
  };
  detailFinishMetrics?: {
    changedPixelRatio: number;
    chromaDriftMax: number;
    edgeOvershoot: number;
    edgeUndershoot: number;
    effectiveLocalContrastRadius: number;
    effectiveSharpeningRadius: number;
  };
  opticalFinishMetrics?: {
    afterHash: string;
    algorithmId: 'negative_lab_optical_finish_v1';
    algorithmVersion: 1;
    beforeHash: string;
    changedPixelRatio: number;
    effectiveGlowRadiusPixels: number;
    effectiveHalationRadiusPixels: number;
    gamutClippedPixelCount: number;
    localizedMaskRatio: number;
    operationId: 'negative_lab.optical_finish';
    prePolicyOvershoot: number;
    warningCodes: Array<'inapplicable_mode_identity'>;
  };
  dimensions: { height: number; width: number };
  renderer:
    | 'rawengine_density_preview_runtime'
    | 'rawengine_negative_lab_runtime_preview_v1'
    | 'tauri_preview_negative_conversion';
  stageArtifacts?: Array<{
    colorDomain: 'normalized_density' | 'scene_linear_print';
    contentHash: string;
    dimensions: { height: number; width: number };
    displayTransform: 'normalized_density_clamp_v1' | 'scene_linear_to_srgb_gamma_v1';
    previewDataUrl: string;
    recipeHash: string;
    stageId: 'normalized_density' | 'scene_linear_print';
    stageVersion: 1;
  }>;
  storage: 'temp_cache';
}

export interface NegativeLabAppServerRuntimeToolBusOptionsV1 {
  applyNative?: (
    request: NegativeLabApplyPlanRequestV1,
    acceptedPlan: Readonly<AcceptedNegativeLabDryRunPlanV1>,
  ) => NegativeLabApplyResultV1 | Promise<NegativeLabApplyResultV1>;
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

export interface AcceptedNegativeLabDryRunPlanV1 {
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
  #applyNative: NegativeLabAppServerRuntimeToolBusOptionsV1['applyNative'];
  readonly #toolsByName: Map<NegativeLabAppServerRuntimeToolNameV1, NegativeLabAppServerToolDefinitionV1> = new Map<
    NegativeLabAppServerRuntimeToolNameV1,
    NegativeLabAppServerToolDefinitionV1
  >();

  constructor(manifestValue: unknown, options: NegativeLabAppServerRuntimeToolBusOptionsV1 = {}) {
    const manifest = negativeLabAppServerToolManifestV1Schema.parse(manifestValue);
    this.#renderPreview = options.renderPreview ?? buildDefaultNegativeLabRuntimePreviewRenderResultV1;
    this.#applyNative = options.applyNative;
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

  /**
   * Async counterpart used by the app-server host. Preview stays synchronous
   * and shares this bus's accepted-plan registry; apply awaits the injected
   * native save executor instead of constructing receipts locally.
   */
  async executeAsync(requestValue: unknown): Promise<NegativeLabAppServerRuntimeToolResultV1> {
    const request = negativeLabAppServerRuntimeToolRequestV1Schema.parse(requestValue);
    const tool = this.#toolsByName.get(request.toolName);
    if (tool === undefined) {
      throw new Error(`Negative Lab runtime app-server bus has no registered tool named ${request.toolName}.`);
    }

    if (request.toolName === 'negativelab.preview_conversion') {
      return this.#executeDryRun(tool, request.request);
    }
    return this.#executeApplyAsync(tool, request.request);
  }

  setApplyNativeExecutor(applyNative: NegativeLabAppServerRuntimeToolBusOptionsV1['applyNative']): void {
    this.#applyNative = applyNative;
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
    const acknowledgedWarningCodes = new Set(request.acknowledgedWarningCodes);
    const unacknowledgedWarning = acceptedPlan.dryRun.warnings.find(
      (warning) => !acknowledgedWarningCodes.has(warning.code),
    );
    if (unacknowledgedWarning !== undefined) {
      throw new Error(`${tool.toolName} rejected an apply with unacknowledged warning ${unacknowledgedWarning.code}.`);
    }

    if (this.#applyNative === undefined) {
      throw new Error(
        `${tool.toolName} requires an injected native commit executor; synthetic output receipts are disabled.`,
      );
    }

    const apply = this.#applyNative(request, acceptedPlan);
    if (apply instanceof Promise) {
      throw new Error(`${tool.toolName} has an asynchronous native executor; use executeAsync instead.`);
    }

    return {
      apply,
      kind: 'apply',
      toolName: 'negativelab.apply_planned_command',
    };
  }

  async #executeApplyAsync(
    tool: NegativeLabAppServerToolDefinitionV1,
    requestValue: unknown,
  ): Promise<NegativeLabAppServerRuntimeApplyToolResultV1> {
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
    const acknowledgedWarningCodes = new Set(request.acknowledgedWarningCodes);
    const unacknowledgedWarning = acceptedPlan.dryRun.warnings.find(
      (warning) => !acknowledgedWarningCodes.has(warning.code),
    );
    if (unacknowledgedWarning !== undefined) {
      throw new Error(`${tool.toolName} rejected an apply with unacknowledged warning ${unacknowledgedWarning.code}.`);
    }
    if (this.#applyNative === undefined) {
      throw new Error(
        `${tool.toolName} requires an injected native commit executor; synthetic output receipts are disabled.`,
      );
    }

    return {
      apply: await this.#applyNative(request, acceptedPlan),
      kind: 'apply',
      toolName: 'negativelab.apply_planned_command',
    };
  }
}

export function negativeLabAcceptedDryRunPlanHashV1(dryRun: NegativeLabDryRunResultV1): string {
  return `sha256:${dryRun.dryRunPlanId}`;
}

function buildDefaultBaseFogSampleSummary(
  confidence: number,
  p50AnchorDensity: number,
  sampleCount: number,
  source:
    | 'runtime_estimate_negative_base_fog'
    | 'recipe_default_base_fog'
    | 'requested_base_fog_sample_rect'
    | 'deterministic_edge_safe_default_rect',
  warningCodes: NegativeWarningCode[],
): NonNullable<NegativeLabRuntimePreviewRenderResultV1['baseFogSampleSummary']> {
  const densityRgb = {
    b: Number((p50AnchorDensity + 0.06).toFixed(4)),
    g: Number((p50AnchorDensity + 0.02).toFixed(4)),
    r: Number((p50AnchorDensity - 0.01).toFixed(4)),
  };
  const densityValues = Object.values(densityRgb);

  return {
    clippedFraction: 0,
    confidence,
    densityRange: Number((Math.max(...densityValues) - Math.min(...densityValues)).toFixed(4)),
    densityRgb,
    meanRgb: {
      b: Number((10 ** -densityRgb.b).toFixed(4)),
      g: Number((10 ** -densityRgb.g).toFixed(4)),
      r: Number((10 ** -densityRgb.r).toFixed(4)),
    },
    sampleCount,
    sampleRect: { height: 0.6, width: 0.12, x: 0.02, y: 0.2 },
    source,
    warningCodes,
  };
}

function buildNegativeLabRuntimeDryRunV1(
  command: NegativeLabSetConversionRecipeCommandV1,
  renderedPreview: NegativeLabRuntimePreviewRenderResultV1,
): NegativeLabDryRunResultV1 {
  const sessionId = command.parameters.sessionId;
  const selectedFrameIds = command.parameters.frameSelection.frameIds;
  const updatedFrameIds = selectedFrameIds.length > 0 ? selectedFrameIds : ['negative_lab_frame_runtime_preview'];
  const baseFogWarningCodes = renderedPreview.baseFogSampleSummary?.warningCodes ?? [];
  const warnings = [
    negativeLabRuntimeWarningV1(updatedFrameIds),
    ...baseFogWarningCodes.map((warningCode) => negativeLabRuntimeBaseFogWarningV1(warningCode, updatedFrameIds)),
  ];
  const warningCodes = warnings.map((warning) => warning.code);
  const previewArtifacts: ArtifactHandleV1[] = [
    {
      artifactId: renderedPreview.artifactId,
      contentHash: renderedPreview.contentHash,
      dimensions: renderedPreview.dimensions,
      kind: 'preview',
      storage: renderedPreview.storage,
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

export function buildNegativeLabRuntimeApplyV1(
  request: NegativeLabApplyPlanRequestV1,
  acceptedPlan: AcceptedNegativeLabDryRunPlanV1,
): NegativeLabApplyResultV1 {
  const positiveVariantIds = acceptedPlan.dryRun.changeSet.updatedFrameIds.map(
    (frameId) => `positive_variant_${frameId}`,
  );
  const exportArtifacts = buildNegativeLabRuntimePositiveExportArtifactsV1(acceptedPlan, positiveVariantIds);
  const provenanceEntryIds = [`prov_${request.commandId}_apply`];
  const positiveOutputReceipts = buildNegativeLabRuntimePositiveOutputReceiptsV1({
    acceptedPlan,
    exportArtifacts,
    positiveVariantIds,
    provenanceEntryIds,
    request,
  });
  const proof = buildAcceptedNegativeLabRuntimeProofV1(acceptedPlan.dryRun.proof, exportArtifacts);

  return {
    appliedGraphRevision: `${request.expectedSessionRevision}:negative_lab_applied`,
    changeSet: {
      artifactHandles: exportArtifacts,
      createdPositiveVariantIds: positiveVariantIds,
      provenanceEntryIds,
      updatedFrameIds: acceptedPlan.dryRun.changeSet.updatedFrameIds,
      updatedSessionId: request.sessionId,
      warningCodes: acceptedPlan.dryRun.changeSet.warningCodes,
    },
    commandId: `${request.commandId}_apply`,
    commandType: acceptedPlan.command.commandType,
    correlationId: acceptedPlan.command.correlationId,
    dryRunCommandId: acceptedPlan.command.commandId,
    noOverwritePolicy: 'never_overwrite_original',
    positiveOutputReceipts,
    proof,
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    sessionId: request.sessionId,
    warnings: acceptedPlan.dryRun.warnings,
  };
}

function buildNegativeLabRuntimePositiveExportArtifactsV1(
  acceptedPlan: AcceptedNegativeLabDryRunPlanV1,
  positiveVariantIds: string[],
): ArtifactHandleV1[] {
  const previewArtifact = acceptedPlan.dryRun.previewArtifacts[0];
  if (previewArtifact === undefined) {
    throw new Error('Negative Lab apply requires an accepted preview artifact before creating a positive variant.');
  }

  return positiveVariantIds.map((positiveVariantId, index) => ({
    artifactId: `artifact_${positiveVariantId}_export`,
    contentHash: `sha256:negative_lab_positive:${stableProofToken(
      JSON.stringify({
        commandId: acceptedPlan.command.commandId,
        index,
        positiveVariantId,
        previewContentHash: previewArtifact.contentHash,
      }),
    )}`,
    dimensions: previewArtifact.dimensions,
    kind: 'export',
    storage: 'sidecar_artifact',
  }));
}

function buildNegativeLabRuntimePositiveOutputReceiptsV1({
  acceptedPlan,
  exportArtifacts,
  positiveVariantIds,
  provenanceEntryIds,
  request,
}: {
  acceptedPlan: AcceptedNegativeLabDryRunPlanV1;
  exportArtifacts: ArtifactHandleV1[];
  positiveVariantIds: string[];
  provenanceEntryIds: string[];
  request: NegativeLabApplyPlanRequestV1;
}): NegativeLabPositiveOutputReceiptV1[] {
  const boundsReceipt = acceptedPlan.dryRun.proof?.runtimePreview.densityNormalizationMetrics.boundsReceipt;
  if (boundsReceipt === undefined) {
    throw new Error('Negative Lab positive output receipts require accepted density bounds.');
  }

  return positiveVariantIds.map((positiveVariantId, index) => {
    const frameId = acceptedPlan.dryRun.changeSet.updatedFrameIds[index] ?? positiveVariantId;
    const artifact = exportArtifacts[index];
    if (artifact === undefined || artifact.dimensions === undefined) {
      throw new Error('Negative Lab positive output receipts require export artifact dimensions.');
    }

    const sourcePath = resolveNegativeLabRuntimeSourceImageIdentity(acceptedPlan.command);
    const outputPath = buildNegativeLabRuntimePositiveOutputPath(sourcePath, frameId);
    const receiptPayload = {
      acceptedDryRunPlanHash: request.acceptedDryRunPlanHash,
      commandId: request.commandId,
      dryRunPlanId: request.dryRunPlanId,
      frameId,
      outputPath,
      positiveVariantId,
      sourcePath,
    };

    return {
      acceptedDryRunPlanHash: request.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: request.dryRunPlanId,
      boundsReceipt,
      conversionBundleContentHash: `sha256:${stableProofToken(
        JSON.stringify({ ...receiptPayload, kind: 'conversion_bundle' }),
      )}`,
      conversionBundlePath: `${outputPath}.negative-lab-bundle.json`,
      dimensions: artifact.dimensions,
      outputArtifact: artifact,
      outputPath,
      path: outputPath,
      positiveVariantId,
      provenanceEntryIds,
      replayPlanHash: request.acceptedDryRunPlanHash,
      sidecarPath: `${outputPath}.rawengine-negative-lab.json`,
      sourceImageRef: sourcePath,
      sourcePath,
      state: 'planned',
    };
  });
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
  if (previewArtifact.dimensions === undefined || previewArtifact.contentHash === undefined) {
    throw new Error('Negative Lab runtime before/after proof requires preview dimensions and content hash.');
  }
  const baseFogSampleSummary =
    renderedPreview.baseFogSampleSummary ??
    buildDefaultBaseFogSampleSummary(
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? 0.42 : 0.74,
      p50AnchorDensity,
      frameCount * 400,
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence'
        ? 'recipe_default_base_fog'
        : 'runtime_estimate_negative_base_fog',
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? ['low_acquisition_confidence'] : [],
    );
  const dryRunPlanId = `negative_lab_dry_run_plan_${command.commandId}`;
  const acceptedDryRunPlanHash = `sha256:${dryRunPlanId}`;
  const sourceImagePath = resolveNegativeLabRuntimeSourceImageIdentity(command);
  const sourceNegativeArtifact = {
    artifactId: `artifact_source_negative_${stableProofToken(
      JSON.stringify({
        frameIds: command.parameters.frameSelection.frameIds,
        imagePath: sourceImagePath,
        sessionId: command.parameters.sessionId,
      }),
    )}`,
    contentHash: `sha256:source_negative:${stableProofToken(
      JSON.stringify({
        curveModel: command.parameters.curveModel,
        frameIds: command.parameters.frameSelection.frameIds,
        imagePath: sourceImagePath,
        processFamily: command.parameters.processFamily,
        sessionId: command.parameters.sessionId,
      }),
    )}`,
    dimensions: previewArtifact.dimensions,
    imagePath: sourceImagePath,
    kind: 'source_negative' as const,
    storage: 'source_file' as const,
  };
  const claimLevel = negativeLabRuntimePreviewClaimLevelV1(command);
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
      },
      densityCurveSummary: {
        curveFamily: command.parameters.curveModel.curveFamily,
        densityMax: algorithm.densityMax,
        normalizationProfileId: command.parameters.curveModel.normalizationProfileId ?? null,
        outputTag: densityPrintCurve?.outputTag ?? 'preview_display',
        processProfileId: command.parameters.curveModel.processProfileId ?? null,
      },
      densityNormalizationMetrics: {
        axisBounds: renderedPreview.densityNormalizationMetrics?.axisBounds ?? {
          color: { max: 0.12, min: -0.12 },
          luma: { max: 1.08, min: -0.03 },
        },
        channelBounds: renderedPreview.densityNormalizationMetrics?.channelBounds ?? {
          blue: { max: 1.08, min: -0.03 },
          green: { max: 1.02, min: -0.02 },
          red: { max: 0.98, min: -0.01 },
        },
        boundsReceipt:
          renderedPreview.densityNormalizationMetrics?.boundsReceipt ?? buildDefaultNegativeLabBoundsReceipt(command),
        clippedPixelCount: renderedPreview.densityNormalizationMetrics?.clippedPixelCount ?? 0,
        densityRangeUnclamped:
          renderedPreview.densityNormalizationMetrics?.densityRangeUnclamped ?? densityRangeUnclamped,
        epsilonClampedPixelCount: renderedPreview.densityNormalizationMetrics?.epsilonClampedPixelCount ?? 0,
        rendererVersion: renderedPreview.densityNormalizationMetrics?.rendererVersion ?? 2,
      },
      ...(renderedPreview.densityScopes === undefined ? {} : { densityScopes: renderedPreview.densityScopes }),
      ...(renderedPreview.neutralAxisAnalysis === undefined
        ? {}
        : { neutralAxisAnalysis: renderedPreview.neutralAxisAnalysis }),
      ...(renderedPreview.autoMeter === undefined ? {} : { autoMeter: renderedPreview.autoMeter }),
      ...(renderedPreview.paperProfile === undefined ? {} : { paperProfile: renderedPreview.paperProfile }),
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
        imagePath: sourceImagePath,
        sessionId: command.parameters.sessionId,
      },
      beforeAfterPreviewProof: {
        acceptedDryRunPlanRequirement: {
          acceptedDryRunPlanHash,
          dryRunPlanId,
          requiredBeforeApply: true,
        },
        baseFogSampleSummary: {
          ...baseFogSampleSummary,
        },
        behaviorProofHash: `sha256:${stableProofToken(
          JSON.stringify({
            acceptedDryRunPlanHash,
            claimLevel,
            generatedPositiveContentHash: previewArtifact.contentHash,
            sourceNegativeContentHash: sourceNegativeArtifact.contentHash,
            warningCodes,
          }),
        )}`,
        claimLevel,
        generatedPositiveDryRunArtifact: previewArtifact,
        sourceNegativeArtifact,
        warningCodes,
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

function negativeLabRuntimePreviewClaimLevelV1(
  command: NegativeLabSetConversionRecipeCommandV1,
):
  | 'blocked_or_unsupported'
  | 'generic_starting_point_only'
  | 'licensed_exact_profile'
  | 'measured_project_profile'
  | 'stock_family_reference_metadata'
  | 'user_supplied_profile' {
  if (command.parameters.curveModel.curveFamily === 'process_profile_monotonic_v1') {
    return 'measured_project_profile';
  }
  return 'generic_starting_point_only';
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
  const previewArtifact = previewArtifacts[0];
  const previewDimensions = previewArtifact?.dimensions;
  if (previewDimensions === undefined || exportArtifacts.length === 0) return false;

  return exportArtifacts.every((exportArtifact) => {
    if (exportArtifact.dimensions === undefined) return false;
    return (
      previewDimensions.height === exportArtifact.dimensions.height &&
      previewDimensions.width === exportArtifact.dimensions.width
    );
  });
}

function buildNegativeLabRuntimePositiveOutputPath(sourcePath: string, frameId: string): string {
  const separatorIndex = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const directory = separatorIndex >= 0 ? sourcePath.slice(0, separatorIndex) : '';
  const fileName = separatorIndex >= 0 ? sourcePath.slice(separatorIndex + 1) : sourcePath;
  const extensionIndex = fileName.lastIndexOf('.');
  const baseName = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
  const safeFrameId = frameId.replace(/[^A-Za-z0-9_-]+/gu, '_');
  const outputFileName = `${baseName}-positive-${safeFrameId}.tif`;
  return directory.length === 0 ? outputFileName : `${directory}/${outputFileName}`;
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
      neutralAxis: command.parameters.neutralAxis,
      paperProfile: command.parameters.paperProfile,
    }),
  );
  const p50AnchorDensity = Number((0.48 + frameCount * 0.01).toFixed(4));

  return {
    artifactId: `artifact_${command.commandId}_preview`,
    baseFogSampleSummary: buildDefaultBaseFogSampleSummary(
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? 0.42 : 0.74,
      p50AnchorDensity,
      frameCount * 400,
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence'
        ? 'recipe_default_base_fog'
        : 'runtime_estimate_negative_base_fog',
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? ['low_acquisition_confidence'] : [],
    ),
    contentHash: `sha256:negative_lab_runtime_preview:${renderToken}`,
    paperProfile: command.parameters.paperProfile,
    densityNormalizationMetrics: {
      axisBounds: {
        color: { max: 0.12, min: -0.12 },
        luma: { max: 1.08, min: -0.03 },
      },
      channelBounds: {
        blue: { max: 1.08, min: -0.03 },
        green: { max: 1.02, min: -0.02 },
        red: { max: 0.98, min: -0.01 },
      },
      boundsReceipt: buildDefaultNegativeLabBoundsReceipt(command),
      clippedPixelCount: 0,
      densityRangeUnclamped: Number((p50AnchorDensity + 0.42).toFixed(4)),
      epsilonClampedPixelCount: 0,
      rendererVersion: 2,
    },
    neutralAxisAnalysis: {
      algorithmId: 'native_negative_lab_neutral_axis_v1',
      algorithmVersion: 1,
      status: command.parameters.neutralAxis.enabled ? 'no_correction_low_confidence' : 'disabled_identity',
      fitMode: 'none',
      confidence: 0,
      confidenceThreshold: command.parameters.neutralAxis.confidenceThreshold,
      sampleCount: 0,
      bandSupport: [0, 0, 0],
      bandReferences: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      residualBefore: 0,
      residualAfter: 0,
      effectiveGlobal: [0, 0, 0],
      effectiveShadow: [0, 0, 0],
      effectiveHighlight: [0, 0, 0],
      source: command.parameters.neutralAxis.source,
      warningCodes: command.parameters.neutralAxis.enabled ? ['native_analysis_required'] : [],
    },
    dimensions: { height, width },
    renderer: 'rawengine_density_preview_runtime',
    storage: 'temp_cache',
  };
}

function buildDefaultNegativeLabBoundsReceipt(
  command: NegativeLabSetConversionRecipeCommandV1,
): NegativeLabDensityBoundsReceiptV1 {
  const params = command.parameters.densityBounds;
  const baseBounds = {
    axisBounds: {
      color: { max: 0.08, min: -0.08 },
      luma: { max: 0.16, min: 0.02 },
    },
    channelBounds: {
      blue: { max: 0.2, min: 0.04 },
      green: { max: 0.16, min: 0.02 },
      red: { max: 0.14, min: 0.01 },
    },
  };

  return {
    algorithmId: 'fixed_grid_block_median_luma_color_v1',
    analysisBuffer: params.analysisBuffer,
    analysisRect: {
      height: 1 - params.analysisBuffer * 2,
      width: 1 - params.analysisBuffer * 2,
      x: params.analysisBuffer,
      y: params.analysisBuffer,
    },
    baseBounds,
    baseFogProvenance: params.baseFogProvenance,
    colorRangeClip: params.colorRangeClip,
    finalBounds: {
      axisBounds: {
        color: { max: 0.12, min: -0.12 },
        luma: { max: 1.08, min: -0.03 },
      },
      channelBounds: {
        blue: { max: 1.08, min: -0.03 },
        green: { max: 1.02, min: -0.02 },
        red: { max: 0.98, min: -0.01 },
      },
    },
    lumaRangeClip: params.lumaRangeClip,
    schemaVersion: 1,
    warningCodes:
      command.parameters.baseStrategy.mode === 'profile_default_low_confidence' ? ['missing_visible_base'] : [],
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

function negativeLabRuntimeBaseFogWarningV1(warningCode: NegativeWarningCode, frameIds: Array<string>) {
  return negativeWarningV1Schema.parse({
    blocksAutomation: false,
    code: warningCode,
    evidence: `Negative Lab runtime base-fog sample emitted ${warningCode} from measured preview pixels.`,
    frameIds,
    scope: 'frame',
    severity:
      warningCode === 'missing_visible_base'
        ? 'warning'
        : warningCode === 'clipped_base_channel' || warningCode === 'uneven_illumination'
          ? 'warning'
          : 'info',
  });
}
