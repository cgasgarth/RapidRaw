import type { z } from 'zod';

import { createFocusStackPlanOnlyDryRunResultV1 } from '../src/focus-stack/focusStackPreflight.js';
import { detectHdrBracketV1 } from '../src/hdr/hdrBracketDetection.js';
import {
  aiAppServerToolManifestV1Schema,
  aiEnhancementApplyResultV1Schema,
  aiEnhancementCommandEnvelopeV1Schema,
  aiEnhancementDryRunResultV1Schema,
  aiToolApplyResultV1Schema,
  aiToolCommandEnvelopeV1Schema,
  aiToolDryRunResultV1Schema,
  artifactHandleV1Schema,
  commandEnvelopeV1Schema,
  computationalMergeAppServerToolManifestV1Schema,
  computationalMergeCommandEnvelopeV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  editGraphCommandEnvelopeV1Schema,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
  editGraphSnapshotQueryV1Schema,
  editGraphSnapshotV1Schema,
  exportApplyResultV1Schema,
  exportCommandEnvelopeV1Schema,
  exportDryRunResultV1Schema,
  filmBlackAndWhiteModelV1Schema,
  filmGlowModelV1Schema,
  filmGrainModelV1Schema,
  filmHalationModelV1Schema,
  filmLookCatalogV1Schema,
  hdrMergeArtifactV1Schema,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  negativeAcquisitionProfileV1Schema,
  negativeLabApplyPlanRequestV1Schema,
  negativeLabApplyResultV1Schema,
  negativeLabAppServerToolManifestV1Schema,
  negativeLabBaseFogEstimateV1Schema,
  negativeLabBaseSampleRecordV1Schema,
  negativeLabBuiltInPresetCatalogV1Schema,
  negativeLabCommandEnvelopeV1Schema,
  negativeLabConversionOperationV1Schema,
  negativeLabDensityNormalizationProfileV1Schema,
  negativeLabDryRunResultV1Schema,
  negativeLabFixtureManifestV1Schema,
  negativeLabFrameDetectionResultV1Schema,
  negativeLabInputProfileCatalogV1Schema,
  negativeLabPerChannelInversionCurveSetV1Schema,
  negativeLabPositiveVariantProvenanceV1Schema,
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  negativeLabProcessProfileV1Schema,
  negativeLabQcProofArtifactV1Schema,
  negativeLabRollBatchWorkflowV1Schema,
  negativeLabStockRegistryV1Schema,
  negativeRollSessionV1Schema,
  panoramaArtifactV1Schema,
  panoramaBackendCapabilityReportV1Schema,
  previewScopeQueryV1Schema,
  previewScopeResultV1Schema,
  projectLibraryCommandEnvelopeV1Schema,
  projectLibraryMutationResultV1Schema,
  projectLibrarySnapshotQueryV1Schema,
  projectLibrarySnapshotV1Schema,
  queryEnvelopeV1Schema,
  rawEngineAgentReplayFixtureV1Schema,
  rawEngineAppServerToolCallValidationV1Schema,
  rawEngineToolRegistryV1Schema,
  superResolutionArtifactV1Schema,
  superResolutionDryRunSummaryV1Schema,
  toneColorCommandEnvelopeV1Schema,
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../src/rawEngineSchemas.js';
import {
  sampleAiAppServerToolManifestV1,
  sampleAiEnhancementAgentReplayFixtureV1,
  sampleAiEnhancementApplyAppServerToolCallValidationV1,
  sampleAiEnhancementApplyCommandEnvelopeV1,
  sampleAiEnhancementApplyResultV1,
  sampleAiEnhancementCommandEnvelopeV1,
  sampleAiEnhancementDryRunAppServerToolCallValidationV1,
  sampleAiEnhancementDryRunResultV1,
  sampleAiMaskApplyAppServerToolCallValidationV1,
  sampleAiMaskDryRunAppServerToolCallValidationV1,
  sampleAiToolAgentReplayFixtureV1,
  sampleAiToolApplyCommandEnvelopeV1,
  sampleAiToolApplyResultV1,
  sampleAiToolCommandEnvelopeV1,
  sampleAiToolDryRunResultV1,
  sampleArtifactHandleV1,
  sampleBasicToneAgentReplayFixtureV1,
  sampleCommandEnvelopeV1,
  sampleComputationalMergeApplyCommandEnvelopeV1,
  sampleComputationalMergeAppServerToolManifestV1,
  sampleComputationalMergeCommandEnvelopeV1,
  sampleComputationalMergeDryRunResultV1,
  sampleComputationalMergeFocusStackApplyAppServerToolCallValidationV1,
  sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  sampleComputationalMergeFocusStackDryRunAppServerToolCallValidationV1,
  sampleComputationalMergeHdrCommandEnvelopeV1,
  sampleComputationalMergeMutationResultV1,
  sampleComputationalMergePanoramaApplyAppServerToolCallValidationV1,
  sampleComputationalMergePanoramaDryRunAppServerToolCallValidationV1,
  sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionApplyAppServerToolCallValidationV1,
  sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionDryRunAppServerToolCallValidationV1,
  sampleEditGraphApplyCommandEnvelopeV1,
  sampleEditGraphCommandEnvelopeV1,
  sampleEditGraphDryRunResultV1,
  sampleEditGraphMutationResultV1,
  sampleEditGraphSnapshotQueryV1,
  sampleEditGraphSnapshotV1,
  sampleExportApplyAppServerToolCallValidationV1,
  sampleExportApplyCommandEnvelopeV1,
  sampleExportApplyResultV1,
  sampleExportCommandEnvelopeV1,
  sampleExportDryRunAppServerToolCallValidationV1,
  sampleExportDryRunResultV1,
  sampleFilmBlackAndWhiteModelV1,
  sampleFilmGlowModelV1,
  sampleFilmGrainModelV1,
  sampleFilmHalationModelV1,
  sampleFilmLookCatalogV1,
  sampleFocusStackArtifactV1,
  sampleHdrMergeArtifactV1,
  sampleLayerMaskApplyCommandEnvelopeV1,
  sampleLayerMaskCommandEnvelopeV1,
  sampleLayerMaskDryRunResultV1,
  sampleLayerMaskMutationResultV1,
  sampleLayerMaskRefineCommandEnvelopeV1,
  sampleNegativeAcquisitionProfileV1,
  sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabApplyResultV1,
  sampleNegativeLabAppServerToolManifestV1,
  sampleNegativeLabBaseFogEstimateV1,
  sampleNegativeLabBaseSampleRecordV1,
  sampleNegativeLabBuiltInPresetCatalogV1,
  sampleNegativeLabCommandEnvelopeV1,
  sampleNegativeLabConversionOperationV1,
  sampleNegativeLabDensityNormalizationProfileV1,
  sampleNegativeLabDryRunResultV1,
  sampleNegativeLabFixtureManifestV1,
  sampleNegativeLabFrameDetectionResultV1,
  sampleNegativeLabInputProfileCatalogV1,
  sampleNegativeLabPerChannelInversionCurveSetV1,
  sampleNegativeLabPositiveVariantProvenanceV1,
  sampleNegativeLabPresetMetadataPolicyCatalogV1,
  sampleNegativeLabProcessProfileV1,
  sampleNegativeLabQcProofArtifactV1,
  sampleNegativeLabRollBatchWorkflowV1,
  sampleNegativeLabStockRegistryV1,
  sampleNegativeRollSessionV1,
  samplePanoramaArtifactV1,
  samplePanoramaBackendCapabilityReportV1,
  samplePreviewScopeQueryV1,
  samplePreviewScopeResultV1,
  sampleProjectLibraryCommandEnvelopeV1,
  sampleProjectLibraryMutationResultV1,
  sampleProjectLibrarySnapshotQueryV1,
  sampleProjectLibrarySnapshotV1,
  sampleQueryEnvelopeV1,
  sampleRawEngineAgentReplayFixtureV1,
  sampleRawEngineAppServerToolCallValidationV1,
  sampleSuperResolutionArtifactV1,
  sampleSuperResolutionDryRunSummaryV1,
  sampleToneColorApplyCommandEnvelopeV1,
  sampleToneColorCommandEnvelopeV1,
  sampleToneColorDryRunResultV1,
  sampleToneColorMutationResultV1,
  sampleToolRegistryV1,
} from '../src/samplePayloads.js';

const validSamples: ReadonlyArray<{
  name: string;
  schema: z.ZodType;
  value: unknown;
}> = [
  {
    name: 'query envelope',
    schema: queryEnvelopeV1Schema,
    value: sampleQueryEnvelopeV1,
  },
  {
    name: 'command envelope',
    schema: commandEnvelopeV1Schema,
    value: sampleCommandEnvelopeV1,
  },
  {
    name: 'artifact handle',
    schema: artifactHandleV1Schema,
    value: sampleArtifactHandleV1,
  },
  {
    name: 'tool registry',
    schema: rawEngineToolRegistryV1Schema,
    value: sampleToolRegistryV1,
  },
  {
    name: 'app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleRawEngineAppServerToolCallValidationV1,
  },
  {
    name: 'agent replay fixture',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleRawEngineAgentReplayFixtureV1,
  },
  {
    name: 'basic tone agent replay fixture',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleBasicToneAgentReplayFixtureV1,
  },
  {
    name: 'AI tool command envelope',
    schema: aiToolCommandEnvelopeV1Schema,
    value: sampleAiToolCommandEnvelopeV1,
  },
  {
    name: 'AI tool apply command envelope',
    schema: aiToolCommandEnvelopeV1Schema,
    value: sampleAiToolApplyCommandEnvelopeV1,
  },
  {
    name: 'AI tool dry-run result',
    schema: aiToolDryRunResultV1Schema,
    value: sampleAiToolDryRunResultV1,
  },
  {
    name: 'AI tool apply result',
    schema: aiToolApplyResultV1Schema,
    value: sampleAiToolApplyResultV1,
  },
  {
    name: 'AI tool agent replay fixture',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleAiToolAgentReplayFixtureV1,
  },
  {
    name: 'AI app-server tool manifest',
    schema: aiAppServerToolManifestV1Schema,
    value: sampleAiAppServerToolManifestV1,
  },
  {
    name: 'AI enhancement command envelope',
    schema: aiEnhancementCommandEnvelopeV1Schema,
    value: sampleAiEnhancementCommandEnvelopeV1,
  },
  {
    name: 'AI enhancement apply command envelope',
    schema: aiEnhancementCommandEnvelopeV1Schema,
    value: sampleAiEnhancementApplyCommandEnvelopeV1,
  },
  {
    name: 'AI enhancement dry-run result',
    schema: aiEnhancementDryRunResultV1Schema,
    value: sampleAiEnhancementDryRunResultV1,
  },
  {
    name: 'AI enhancement apply result',
    schema: aiEnhancementApplyResultV1Schema,
    value: sampleAiEnhancementApplyResultV1,
  },
  {
    name: 'AI enhancement agent replay fixture',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleAiEnhancementAgentReplayFixtureV1,
  },
  {
    name: 'AI enhancement dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiEnhancementDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'AI enhancement apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiEnhancementApplyAppServerToolCallValidationV1,
  },
  {
    name: 'AI mask dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiMaskDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'AI mask apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiMaskApplyAppServerToolCallValidationV1,
  },
  {
    name: 'export command envelope',
    schema: exportCommandEnvelopeV1Schema,
    value: sampleExportCommandEnvelopeV1,
  },
  {
    name: 'export apply command envelope',
    schema: exportCommandEnvelopeV1Schema,
    value: sampleExportApplyCommandEnvelopeV1,
  },
  {
    name: 'export dry-run result',
    schema: exportDryRunResultV1Schema,
    value: sampleExportDryRunResultV1,
  },
  {
    name: 'export apply result',
    schema: exportApplyResultV1Schema,
    value: sampleExportApplyResultV1,
  },
  {
    name: 'export dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleExportDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'export apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleExportApplyAppServerToolCallValidationV1,
  },
  {
    name: 'edit graph snapshot query',
    schema: editGraphSnapshotQueryV1Schema,
    value: sampleEditGraphSnapshotQueryV1,
  },
  {
    name: 'edit graph snapshot',
    schema: editGraphSnapshotV1Schema,
    value: sampleEditGraphSnapshotV1,
  },
  {
    name: 'edit graph command envelope',
    schema: editGraphCommandEnvelopeV1Schema,
    value: sampleEditGraphCommandEnvelopeV1,
  },
  {
    name: 'edit graph apply command envelope',
    schema: editGraphCommandEnvelopeV1Schema,
    value: sampleEditGraphApplyCommandEnvelopeV1,
  },
  {
    name: 'edit graph dry-run result',
    schema: editGraphDryRunResultV1Schema,
    value: sampleEditGraphDryRunResultV1,
  },
  {
    name: 'edit graph mutation result',
    schema: editGraphMutationResultV1Schema,
    value: sampleEditGraphMutationResultV1,
  },
  {
    name: 'tone color command envelope',
    schema: toneColorCommandEnvelopeV1Schema,
    value: sampleToneColorCommandEnvelopeV1,
  },
  {
    name: 'tone color apply command envelope',
    schema: toneColorCommandEnvelopeV1Schema,
    value: sampleToneColorApplyCommandEnvelopeV1,
  },
  {
    name: 'tone color dry-run result',
    schema: toneColorDryRunResultV1Schema,
    value: sampleToneColorDryRunResultV1,
  },
  {
    name: 'tone color mutation result',
    schema: toneColorMutationResultV1Schema,
    value: sampleToneColorMutationResultV1,
  },
  {
    name: 'layer mask command envelope',
    schema: layerMaskCommandEnvelopeV1Schema,
    value: sampleLayerMaskCommandEnvelopeV1,
  },
  {
    name: 'layer mask apply command envelope',
    schema: layerMaskCommandEnvelopeV1Schema,
    value: sampleLayerMaskApplyCommandEnvelopeV1,
  },
  {
    name: 'layer mask refine command envelope',
    schema: layerMaskCommandEnvelopeV1Schema,
    value: sampleLayerMaskRefineCommandEnvelopeV1,
  },
  {
    name: 'layer mask dry-run result',
    schema: layerMaskDryRunResultV1Schema,
    value: sampleLayerMaskDryRunResultV1,
  },
  {
    name: 'layer mask mutation result',
    schema: layerMaskMutationResultV1Schema,
    value: sampleLayerMaskMutationResultV1,
  },
  {
    name: 'computational merge command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeCommandEnvelopeV1,
  },
  {
    name: 'computational merge HDR command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeHdrCommandEnvelopeV1,
  },
  {
    name: 'computational merge focus stack command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeFocusStackCommandEnvelopeV1,
  },
  {
    name: 'computational merge focus stack apply command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  },
  {
    name: 'computational merge super-resolution command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  },
  {
    name: 'computational merge single-image super-resolution command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1,
  },
  {
    name: 'computational merge apply command envelope',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeApplyCommandEnvelopeV1,
  },
  {
    name: 'computational merge dry-run result',
    schema: computationalMergeDryRunResultV1Schema,
    value: sampleComputationalMergeDryRunResultV1,
  },
  {
    name: 'computational merge mutation result',
    schema: computationalMergeMutationResultV1Schema,
    value: sampleComputationalMergeMutationResultV1,
  },
  {
    name: 'computational merge app-server tool manifest',
    schema: computationalMergeAppServerToolManifestV1Schema,
    value: sampleComputationalMergeAppServerToolManifestV1,
  },
  {
    name: 'computational merge panorama dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergePanoramaDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge panorama apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergePanoramaApplyAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge focus stack dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeFocusStackDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge focus stack apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeFocusStackApplyAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge super-resolution dry-run app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeSuperResolutionDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge super-resolution apply app-server tool call validation',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeSuperResolutionApplyAppServerToolCallValidationV1,
  },
  {
    name: 'HDR merge artifact',
    schema: hdrMergeArtifactV1Schema,
    value: sampleHdrMergeArtifactV1,
  },
  {
    name: 'super-resolution dry-run summary',
    schema: superResolutionDryRunSummaryV1Schema,
    value: sampleSuperResolutionDryRunSummaryV1,
  },
  {
    name: 'super-resolution artifact',
    schema: superResolutionArtifactV1Schema,
    value: sampleSuperResolutionArtifactV1,
  },
  {
    name: 'preview scope query',
    schema: previewScopeQueryV1Schema,
    value: samplePreviewScopeQueryV1,
  },
  {
    name: 'preview scope result',
    schema: previewScopeResultV1Schema,
    value: samplePreviewScopeResultV1,
  },
  {
    name: 'project library snapshot query',
    schema: projectLibrarySnapshotQueryV1Schema,
    value: sampleProjectLibrarySnapshotQueryV1,
  },
  {
    name: 'project library snapshot',
    schema: projectLibrarySnapshotV1Schema,
    value: sampleProjectLibrarySnapshotV1,
  },
  {
    name: 'project library command envelope',
    schema: projectLibraryCommandEnvelopeV1Schema,
    value: sampleProjectLibraryCommandEnvelopeV1,
  },
  {
    name: 'project library mutation result',
    schema: projectLibraryMutationResultV1Schema,
    value: sampleProjectLibraryMutationResultV1,
  },
  {
    name: 'panorama artifact',
    schema: panoramaArtifactV1Schema,
    value: samplePanoramaArtifactV1,
  },
  {
    name: 'panorama backend capability report',
    schema: panoramaBackendCapabilityReportV1Schema,
    value: samplePanoramaBackendCapabilityReportV1,
  },
  {
    name: 'film look catalog',
    schema: filmLookCatalogV1Schema,
    value: sampleFilmLookCatalogV1,
  },
  {
    name: 'film black and white model',
    schema: filmBlackAndWhiteModelV1Schema,
    value: sampleFilmBlackAndWhiteModelV1,
  },
  {
    name: 'film grain model',
    schema: filmGrainModelV1Schema,
    value: sampleFilmGrainModelV1,
  },
  {
    name: 'film halation model',
    schema: filmHalationModelV1Schema,
    value: sampleFilmHalationModelV1,
  },
  {
    name: 'film glow model',
    schema: filmGlowModelV1Schema,
    value: sampleFilmGlowModelV1,
  },
  {
    name: 'negative acquisition profile',
    schema: negativeAcquisitionProfileV1Schema,
    value: sampleNegativeAcquisitionProfileV1,
  },
  {
    name: 'negative roll session',
    schema: negativeRollSessionV1Schema,
    value: sampleNegativeRollSessionV1,
  },
  {
    name: 'negative lab command envelope',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabCommandEnvelopeV1,
  },
  {
    name: 'negative lab apply frame crop command envelope',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  },
  {
    name: 'negative lab dry-run result',
    schema: negativeLabDryRunResultV1Schema,
    value: sampleNegativeLabDryRunResultV1,
  },
  {
    name: 'negative lab apply plan request',
    schema: negativeLabApplyPlanRequestV1Schema,
    value: sampleNegativeLabApplyPlanRequestV1,
  },
  {
    name: 'negative lab apply result',
    schema: negativeLabApplyResultV1Schema,
    value: sampleNegativeLabApplyResultV1,
  },
  {
    name: 'negative lab conversion operation',
    schema: negativeLabConversionOperationV1Schema,
    value: sampleNegativeLabConversionOperationV1,
  },
  {
    name: 'negative lab app-server tool manifest',
    schema: negativeLabAppServerToolManifestV1Schema,
    value: sampleNegativeLabAppServerToolManifestV1,
  },
  {
    name: 'negative lab density normalization profile',
    schema: negativeLabDensityNormalizationProfileV1Schema,
    value: sampleNegativeLabDensityNormalizationProfileV1,
  },
  {
    name: 'negative lab frame detection result',
    schema: negativeLabFrameDetectionResultV1Schema,
    value: sampleNegativeLabFrameDetectionResultV1,
  },
  {
    name: 'negative lab base sample record',
    schema: negativeLabBaseSampleRecordV1Schema,
    value: sampleNegativeLabBaseSampleRecordV1,
  },
  {
    name: 'negative lab base fog estimate',
    schema: negativeLabBaseFogEstimateV1Schema,
    value: sampleNegativeLabBaseFogEstimateV1,
  },
  {
    name: 'negative lab process profile',
    schema: negativeLabProcessProfileV1Schema,
    value: sampleNegativeLabProcessProfileV1,
  },
  {
    name: 'negative lab per-channel inversion curve set',
    schema: negativeLabPerChannelInversionCurveSetV1Schema,
    value: sampleNegativeLabPerChannelInversionCurveSetV1,
  },
  {
    name: 'negative lab QC proof artifact',
    schema: negativeLabQcProofArtifactV1Schema,
    value: sampleNegativeLabQcProofArtifactV1,
  },
  {
    name: 'negative lab roll batch workflow',
    schema: negativeLabRollBatchWorkflowV1Schema,
    value: sampleNegativeLabRollBatchWorkflowV1,
  },
  {
    name: 'negative lab positive variant provenance',
    schema: negativeLabPositiveVariantProvenanceV1Schema,
    value: sampleNegativeLabPositiveVariantProvenanceV1,
  },
  {
    name: 'negative lab built-in preset catalog',
    schema: negativeLabBuiltInPresetCatalogV1Schema,
    value: sampleNegativeLabBuiltInPresetCatalogV1,
  },
  {
    name: 'negative lab stock registry',
    schema: negativeLabStockRegistryV1Schema,
    value: sampleNegativeLabStockRegistryV1,
  },
  {
    name: 'negative lab preset metadata policy catalog',
    schema: negativeLabPresetMetadataPolicyCatalogV1Schema,
    value: sampleNegativeLabPresetMetadataPolicyCatalogV1,
  },
  {
    name: 'negative lab fixture manifest',
    schema: negativeLabFixtureManifestV1Schema,
    value: sampleNegativeLabFixtureManifestV1,
  },
  {
    name: 'negative lab input profile catalog',
    schema: negativeLabInputProfileCatalogV1Schema,
    value: sampleNegativeLabInputProfileCatalogV1,
  },
];

const expectInvalid = (name: string, schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    throw new Error(`Expected ${name} to be rejected.`);
  }
};

const expectEqual = (name: string, left: unknown, right: unknown) => {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Expected ${name}.`);
  }
};

const expectThrows = (name: string, action: () => unknown) => {
  try {
    action();
  } catch {
    return;
  }

  throw new Error(`Expected ${name} to throw.`);
};

const replayDryRunStep = sampleRawEngineAgentReplayFixtureV1.steps[0];
const replayApplyStep = sampleRawEngineAgentReplayFixtureV1.steps[1];
const aiReplayDryRunStep = sampleAiToolAgentReplayFixtureV1.steps[0];
const aiReplayApplyStep = sampleAiToolAgentReplayFixtureV1.steps[1];

if (
  replayDryRunStep === undefined ||
  replayApplyStep === undefined ||
  aiReplayDryRunStep === undefined ||
  aiReplayApplyStep === undefined
) {
  throw new Error('Expected sample agent replay fixtures to contain dry-run and apply steps.');
}

for (const sample of validSamples) {
  const parsed = sample.schema.safeParse(sample.value);
  if (!parsed.success) {
    throw new Error(`Expected valid ${sample.name}: ${parsed.error.message}`);
  }
}

const sampleFocusStackPreflightSourceStates = sampleFocusStackArtifactV1.sourceState.map((sourceState) => ({
  contentHash: sourceState.contentHash,
  graphRevision: sourceState.graphRevision,
  sourceIndex: sourceState.sourceIndex,
}));

const sampleFocusStackPlanOnlyDryRunResult = createFocusStackPlanOnlyDryRunResultV1(
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  {
    planId: 'merge_plan_focus_stack_plan_only_001',
    predictedGraphRevision: 'graph_rev_48_focus_stack_preview',
    sourceStates: sampleFocusStackPreflightSourceStates,
  },
);

if (sampleFocusStackPlanOnlyDryRunResult.mergePlan.preflight.status !== 'accepted') {
  throw new Error('Expected focus-stack plan-only dry-run preflight to be accepted.');
}

const sampleBlockedFocusStackPlanOnlyDryRunResult = createFocusStackPlanOnlyDryRunResultV1(
  sampleComputationalMergeFocusStackCommandEnvelopeV1,
  {
    planId: 'merge_plan_focus_stack_blocked_missing_source_state',
    sourceStates: sampleFocusStackPreflightSourceStates.slice(0, 2),
  },
);

if (sampleBlockedFocusStackPlanOnlyDryRunResult.mergePlan.preflight.status !== 'blocked_plan_only') {
  throw new Error('Expected focus-stack plan-only dry-run preflight to block missing source state.');
}

expectThrows('focus-stack plan-only preflight with apply command', () =>
  createFocusStackPlanOnlyDryRunResultV1(sampleComputationalMergeFocusStackApplyCommandEnvelopeV1, {
    sourceStates: sampleFocusStackPreflightSourceStates,
  }),
);

const sampleDetectedHdrBracket = detectHdrBracketV1({
  sources: sampleHdrMergeArtifactV1.bracketDetection.sourceMetadata,
});

if (!sampleDetectedHdrBracket.accepted) {
  throw new Error('Expected HDR bracket detector to accept the sample bracket.');
}

if (sampleDetectedHdrBracket.referenceSourceIndex !== 1) {
  throw new Error('Expected HDR bracket detector to choose the 0 EV source as reference.');
}

if (sampleDetectedHdrBracket.bracketSpanEv !== 4) {
  throw new Error('Expected HDR bracket detector to preserve the sample bracket span.');
}

const missingExposureHdrBracket = detectHdrBracketV1({
  sources: sampleHdrMergeArtifactV1.bracketDetection.sourceMetadata.map((source) => {
    const { declaredExposureEv, resolvedBracketRole, resolvedExposureEv, ...sourceWithoutExposureEvidence } = source;
    void declaredExposureEv;
    void resolvedBracketRole;
    void resolvedExposureEv;

    return {
      ...sourceWithoutExposureEvidence,
      exposureCompensationEv: undefined,
      exposureTimeSeconds: undefined,
    };
  }),
});

if (
  missingExposureHdrBracket.accepted ||
  !missingExposureHdrBracket.blockCodes.includes('missing_required_exposure_metadata')
) {
  throw new Error('Expected HDR bracket detector to reject missing exposure metadata.');
}

if (missingExposureHdrBracket.sourceMetadata.some((source) => source.resolvedBracketRole !== 'unknown')) {
  throw new Error('Expected HDR bracket detector to mark unresolved exposure roles as unknown.');
}

const duplicateExposureHdrBracket = detectHdrBracketV1({
  sources: sampleHdrMergeArtifactV1.bracketDetection.sourceMetadata.map((source) => ({
    ...source,
    declaredExposureEv: 0,
  })),
});

if (
  duplicateExposureHdrBracket.accepted ||
  !duplicateExposureHdrBracket.blockCodes.includes('duplicate_exposure_values')
) {
  throw new Error('Expected HDR bracket detector to reject duplicate exposure values.');
}

const invalidToolRegistry = {
  ...sampleToolRegistryV1,
  extra: 'reject unknown registry fields',
};

const invalidResult = rawEngineToolRegistryV1Schema.safeParse(invalidToolRegistry);
if (invalidResult.success) {
  throw new Error('Expected tool registry schema to reject unknown fields.');
}

expectInvalid('app-server tool call with unregistered tool', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleRawEngineAppServerToolCallValidationV1,
  toolCall: {
    ...sampleRawEngineAppServerToolCallValidationV1.toolCall,
    toolName: 'edit.unregistered_tool',
  },
});

expectInvalid('app-server tool call with mismatched tool kind', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleRawEngineAppServerToolCallValidationV1,
  toolCall: {
    ...sampleRawEngineAppServerToolCallValidationV1.toolCall,
    toolKind: 'read',
  },
});

expectInvalid('app-server tool call with mismatched input schema', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleRawEngineAppServerToolCallValidationV1,
  toolCall: {
    ...sampleRawEngineAppServerToolCallValidationV1.toolCall,
    inputSchemaName: 'QueryEnvelopeV1',
  },
});

expectInvalid('app-server tool call with mismatched dryRun flag', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleRawEngineAppServerToolCallValidationV1,
  toolCall: {
    ...sampleRawEngineAppServerToolCallValidationV1.toolCall,
    dryRun: false,
  },
});

expectInvalid('agent replay with unregistered tool', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  steps: [
    {
      ...replayDryRunStep,
      toolName: 'tonecolor.unregistered_command',
    },
    replayApplyStep,
  ],
});

expectInvalid('agent replay with mismatched input schema', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  steps: [
    {
      ...replayDryRunStep,
      inputSchemaName: 'QueryEnvelopeV1',
    },
    replayApplyStep,
  ],
});

expectInvalid('agent replay mutating step without approval', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  steps: [
    replayDryRunStep,
    {
      ...replayApplyStep,
      approval: {
        ...replayApplyStep.approval,
        state: 'pending',
      },
    },
  ],
});

expectInvalid('agent replay dry-run marked as mutating', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  steps: [
    {
      ...replayDryRunStep,
      mutates: true,
      resultingGraphRevision: 'graph_rev_invalid_preview_mutation',
    },
    replayApplyStep,
  ],
});

expectInvalid('agent replay with future prerequisite', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  steps: [
    {
      ...replayDryRunStep,
      prerequisiteStepIds: ['step_tone_color_apply'],
    },
    replayApplyStep,
  ],
});

expectInvalid('agent replay with mismatched final graph revision', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleRawEngineAgentReplayFixtureV1,
  finalGraphRevision: 'graph_rev_not_from_last_mutation',
});

expectInvalid('AI dry-run command with cloud provider marked local-only', aiToolCommandEnvelopeV1Schema, {
  ...sampleAiToolCommandEnvelopeV1,
  parameters: {
    ...sampleAiToolCommandEnvelopeV1.parameters,
    providerClass: 'cloud_service',
    sourcePixelDisclosure: 'local_only',
  },
});

expectInvalid('AI apply command missing dry-run plan id', aiToolCommandEnvelopeV1Schema, {
  ...sampleAiToolApplyCommandEnvelopeV1,
  parameters: {
    ...sampleAiToolApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanId: undefined,
  },
});

expectInvalid('AI apply command without generative approval', aiToolCommandEnvelopeV1Schema, {
  ...sampleAiToolApplyCommandEnvelopeV1,
  approval: {
    ...sampleAiToolApplyCommandEnvelopeV1.approval,
    approvalClass: 'edit_apply',
  },
});

expectInvalid('AI agent replay with mismatched output schema', rawEngineAgentReplayFixtureV1Schema, {
  ...sampleAiToolAgentReplayFixtureV1,
  steps: [
    aiReplayDryRunStep,
    {
      ...aiReplayApplyStep,
      outputSchemaName: 'LayerMaskMutationResultV1',
    },
  ],
});

expectInvalid('AI app-server tool call with mismatched tool name', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleAiMaskDryRunAppServerToolCallValidationV1,
  toolCall: {
    ...sampleAiMaskDryRunAppServerToolCallValidationV1.toolCall,
    toolName: 'ai.mask.apply_subject',
  },
});

expectInvalid('AI app-server apply call without approved state', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleAiMaskApplyAppServerToolCallValidationV1,
  toolCall: {
    ...sampleAiMaskApplyAppServerToolCallValidationV1.toolCall,
    approval: {
      ...sampleAiMaskApplyAppServerToolCallValidationV1.toolCall.approval,
      state: 'pending',
    },
  },
});

expectInvalid(
  'AI enhancement dry-run command with cloud provider marked local-only',
  aiEnhancementCommandEnvelopeV1Schema,
  {
    ...sampleAiEnhancementCommandEnvelopeV1,
    parameters: {
      ...sampleAiEnhancementCommandEnvelopeV1.parameters,
      providerClass: 'cloud_service',
      sourcePixelDisclosure: 'local_only',
    },
  },
);

expectInvalid('AI enhancement apply command missing dry-run plan id', aiEnhancementCommandEnvelopeV1Schema, {
  ...sampleAiEnhancementApplyCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementApplyCommandEnvelopeV1.parameters,
    acceptedDryRunPlanId: undefined,
  },
});

expectInvalid('AI enhancement operator prompt without prompt text', aiEnhancementCommandEnvelopeV1Schema, {
  ...sampleAiEnhancementCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementCommandEnvelopeV1.parameters,
    promptPolicy: 'operator_prompt',
  },
});

expectInvalid('AI inpaint enhancement without region mask', aiEnhancementCommandEnvelopeV1Schema, {
  ...sampleAiEnhancementCommandEnvelopeV1,
  parameters: {
    ...sampleAiEnhancementCommandEnvelopeV1.parameters,
    capability: 'inpaint',
    regionMaskArtifactId: undefined,
  },
});

expectInvalid('AI enhancement app-server dry-run with mask output schema', aiAppServerToolManifestV1Schema, {
  ...sampleAiAppServerToolManifestV1,
  tools: sampleAiAppServerToolManifestV1.tools.map((tool) =>
    tool.toolName === 'ai.enhancement.dry_run_command'
      ? {
          ...tool,
          outputSchemaName: 'AiToolDryRunResultV1',
        }
      : tool,
  ),
});

expectInvalid('export JPEG command with 16-bit output', exportCommandEnvelopeV1Schema, {
  ...sampleExportCommandEnvelopeV1,
  parameters: {
    ...sampleExportCommandEnvelopeV1.parameters,
    bitDepth: 16,
  },
});

expectInvalid('export TIFF command with JPEG quality', exportCommandEnvelopeV1Schema, {
  ...sampleExportCommandEnvelopeV1,
  parameters: {
    ...sampleExportCommandEnvelopeV1.parameters,
    format: 'tiff',
  },
});

expectInvalid('export fit-long-edge command missing max edge', exportCommandEnvelopeV1Schema, {
  ...sampleExportCommandEnvelopeV1,
  parameters: {
    ...sampleExportCommandEnvelopeV1.parameters,
    maxLongEdgePx: undefined,
  },
});

expectInvalid('export write command missing destination directory', exportCommandEnvelopeV1Schema, {
  ...sampleExportApplyCommandEnvelopeV1,
  parameters: {
    ...sampleExportApplyCommandEnvelopeV1.parameters,
    destinationDirectory: undefined,
  },
});

expectInvalid('export write app-server call without approved state', rawEngineAppServerToolCallValidationV1Schema, {
  ...sampleExportApplyAppServerToolCallValidationV1,
  toolCall: {
    ...sampleExportApplyAppServerToolCallValidationV1.toolCall,
    approval: {
      ...sampleExportApplyAppServerToolCallValidationV1.toolCall.approval,
      state: 'pending',
    },
    arguments: {
      ...sampleExportApplyCommandEnvelopeV1,
      approval: {
        ...sampleExportApplyCommandEnvelopeV1.approval,
        state: 'pending',
      },
    },
  },
});

expectInvalid('preview scope result without scope payloads', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: undefined,
  rgbParade: undefined,
  vectorscope: undefined,
  waveform: undefined,
});

expectInvalid('preview scope result with mismatched parade channel', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  rgbParade: {
    ...samplePreviewScopeResultV1.rgbParade,
    channel: 'rgb',
  },
});

expectInvalid('preview scope result with mismatched vectorscope channel', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  vectorscope: {
    ...samplePreviewScopeResultV1.vectorscope,
    channel: 'rgb',
  },
});

const samplePreviewHistogramV1 = samplePreviewScopeResultV1.histogram;
if (samplePreviewHistogramV1 === undefined) {
  throw new Error('samplePreviewScopeResultV1 must include a histogram.');
}

const [samplePreviewHistogramLumaV1, samplePreviewHistogramRedV1] = samplePreviewHistogramV1.channels;
if (samplePreviewHistogramLumaV1 === undefined || samplePreviewHistogramRedV1 === undefined) {
  throw new Error('samplePreviewScopeResultV1 histogram must include at least two channels.');
}

expectInvalid('preview scope result with histogram bin mismatch', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...samplePreviewHistogramV1,
    channels: samplePreviewHistogramV1.channels.map((channel, index) =>
      index === 0
        ? {
            ...channel,
            bins: channel.bins.slice(1),
          }
        : channel,
    ),
  },
});

expectInvalid('preview scope result with duplicate histogram channel', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...samplePreviewHistogramV1,
    channels: [
      samplePreviewHistogramLumaV1,
      {
        ...samplePreviewHistogramRedV1,
        channel: samplePreviewHistogramLumaV1.channel,
      },
    ],
  },
});

expectInvalid('preview scope result with inverted histogram percentile', previewScopeResultV1Schema, {
  ...samplePreviewScopeResultV1,
  histogram: {
    ...samplePreviewHistogramV1,
    channels: samplePreviewHistogramV1.channels.map((channel, index) =>
      index === 0
        ? {
            ...channel,
            percentile01: 0.9,
            percentile99: 0.1,
          }
        : channel,
    ),
  },
});

expectInvalid('preview scope query with empty scope selection', previewScopeQueryV1Schema, {
  ...samplePreviewScopeQueryV1,
  parameters: {
    ...samplePreviewScopeQueryV1.parameters,
    includeScopes: [],
  },
});

expectInvalid('project library command without approved apply state', projectLibraryCommandEnvelopeV1Schema, {
  ...sampleProjectLibraryCommandEnvelopeV1,
  approval: {
    ...sampleProjectLibraryCommandEnvelopeV1.approval,
    state: 'pending',
  },
});

expectInvalid('project library command with wrong approval class', projectLibraryCommandEnvelopeV1Schema, {
  ...sampleProjectLibraryCommandEnvelopeV1,
  approval: {
    ...sampleProjectLibraryCommandEnvelopeV1.approval,
    approvalClass: 'edit_apply',
  },
});

expectInvalid('project library mutation result missing revision', projectLibraryMutationResultV1Schema, {
  ...sampleProjectLibraryMutationResultV1,
  resultingLibraryRevision: undefined,
});

expectInvalid('edit graph apply command without approved state', editGraphCommandEnvelopeV1Schema, {
  ...sampleEditGraphApplyCommandEnvelopeV1,
  approval: {
    ...sampleEditGraphApplyCommandEnvelopeV1.approval,
    state: 'pending',
  },
});

expectInvalid('edit graph dry-run command with edit apply approval', editGraphCommandEnvelopeV1Schema, {
  ...sampleEditGraphCommandEnvelopeV1,
  approval: {
    ...sampleEditGraphCommandEnvelopeV1.approval,
    approvalClass: 'edit_apply',
  },
});

expectInvalid('edit graph patch operation without value', editGraphCommandEnvelopeV1Schema, {
  ...sampleEditGraphCommandEnvelopeV1,
  parameters: {
    ...sampleEditGraphCommandEnvelopeV1.parameters,
    operations: [
      {
        nodeId: 'node_agent_refinement',
        op: 'replace',
        path: '/parameters/exposure',
      },
    ],
  },
});

expectInvalid('edit graph snapshot with invalid history index', editGraphSnapshotV1Schema, {
  ...sampleEditGraphSnapshotV1,
  activeHistoryIndex: sampleEditGraphSnapshotV1.history.length,
});

expectInvalid('tone color apply command without approved state', toneColorCommandEnvelopeV1Schema, {
  ...sampleToneColorApplyCommandEnvelopeV1,
  approval: {
    ...sampleToneColorApplyCommandEnvelopeV1.approval,
    state: 'pending',
  },
});

expectInvalid('tone color dry-run command with edit apply approval', toneColorCommandEnvelopeV1Schema, {
  ...sampleToneColorCommandEnvelopeV1,
  approval: {
    ...sampleToneColorCommandEnvelopeV1.approval,
    approvalClass: 'edit_apply',
  },
});

expectInvalid('tone color curve with unordered points', toneColorCommandEnvelopeV1Schema, {
  ...sampleToneColorCommandEnvelopeV1,
  commandType: 'toneColor.setToneCurve',
  parameters: {
    channel: 'luma',
    interpolation: 'monotone_cubic',
    points: [
      { input: 0, output: 0 },
      { input: 0, output: 0.1 },
      { input: 1, output: 1 },
    ],
  },
});

expectInvalid('tone color custom white balance without tint', toneColorCommandEnvelopeV1Schema, {
  ...sampleToneColorCommandEnvelopeV1,
  commandType: 'toneColor.setWhiteBalance',
  parameters: {
    mode: 'custom_kelvin_tint',
    temperatureKelvin: 5200,
  },
});

expectInvalid('tone color identity CAT with mismatched white points', toneColorCommandEnvelopeV1Schema, {
  ...sampleToneColorCommandEnvelopeV1,
  colorPipeline: {
    ...sampleToneColorCommandEnvelopeV1.colorPipeline,
    chromaticAdaptation: {
      method: 'identity_same_white_v1',
      sourceWhitePoint: {
        x: 0.3457,
        y: 0.3585,
      },
      status: 'skipped',
      targetWhitePoint: {
        x: 0.32168,
        y: 0.33767,
      },
      warnings: [],
    },
  },
});

expectInvalid('layer mask apply command without approved state', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskApplyCommandEnvelopeV1,
  approval: {
    ...sampleLayerMaskApplyCommandEnvelopeV1.approval,
    state: 'pending',
  },
});

expectInvalid('layer mask dry-run command with edit apply approval', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskCommandEnvelopeV1,
  approval: {
    ...sampleLayerMaskCommandEnvelopeV1.approval,
    approvalClass: 'edit_apply',
  },
});

expectInvalid('layer insertion command without required reference layer', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskCommandEnvelopeV1,
  commandType: 'layerMask.createLayer',
  parameters: {
    blendMode: 'normal',
    layerName: 'Sky Burn',
    opacity: 0.8,
    position: 'above_layer',
    visible: true,
  },
});

expectInvalid('layer luminance range mask with inverted range', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskCommandEnvelopeV1,
  commandType: 'layerMask.createRangeMask',
  parameters: {
    maskName: 'Highlights',
    selection: {
      feather: 0.12,
      maxLuma: 0.3,
      minLuma: 0.7,
      rangeKind: 'luminance',
    },
    source: 'working_rgb',
  },
});

expectInvalid('layer mask combine command with repeated source masks', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskCommandEnvelopeV1,
  commandType: 'layerMask.combineMasks',
  parameters: {
    combineMode: 'add',
    maskName: 'Combined Portrait',
    sourceMaskIds: ['mask_subject', 'mask_subject'],
  },
});

expectInvalid('layer mask refine command with out-of-range edge shift', layerMaskCommandEnvelopeV1Schema, {
  ...sampleLayerMaskRefineCommandEnvelopeV1,
  parameters: {
    ...sampleLayerMaskRefineCommandEnvelopeV1.parameters,
    refinement: {
      density: 0.8,
      edgeContrast: 0.3,
      edgeShiftPx: 900,
      featherPx: 8,
      smoothness: 0.2,
    },
  },
});

expectInvalid('computational merge apply command without approved state', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeApplyCommandEnvelopeV1,
  approval: {
    ...sampleComputationalMergeApplyCommandEnvelopeV1.approval,
    state: 'pending',
  },
});

expectInvalid(
  'computational merge apply command without accepted dry-run plan',
  computationalMergeCommandEnvelopeV1Schema,
  {
    ...sampleComputationalMergeApplyCommandEnvelopeV1,
    parameters: {
      ...sampleComputationalMergeApplyCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: undefined,
      acceptedDryRunPlanId: undefined,
    },
  },
);

expectInvalid(
  'computational merge dry-run command with edit apply approval',
  computationalMergeCommandEnvelopeV1Schema,
  {
    ...sampleComputationalMergeCommandEnvelopeV1,
    approval: {
      ...sampleComputationalMergeCommandEnvelopeV1.approval,
      approvalClass: 'edit_apply',
    },
  },
);

expectInvalid('super-resolution apply command above 1x without alignment', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeSuperResolutionApplyCommandEnvelopeV1.parameters,
    alignmentMode: 'none',
  },
});

expectInvalid('computational merge command with duplicate source indexes', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeCommandEnvelopeV1.parameters,
    sources: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.map((source) => ({
      ...source,
      sourceIndex: 0,
    })),
  },
});

expectInvalid('computational merge command with mismatched source role', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeCommandEnvelopeV1.parameters,
    sources: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.map((source, sourceIndex) => ({
      ...source,
      role: sourceIndex === 0 ? 'hdr_bracket' : 'panorama_tile',
    })),
  },
});

expectInvalid('panorama merge command with invalid memory budget', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeCommandEnvelopeV1.parameters,
    memoryBudgetBytes: 0,
  },
});

expectInvalid('computational merge dry-run with mismatched memory total', computationalMergeDryRunResultV1Schema, {
  ...sampleComputationalMergeDryRunResultV1,
  mergePlan: {
    ...sampleComputationalMergeDryRunResultV1.mergePlan,
    preflight: {
      ...sampleComputationalMergeDryRunResultV1.mergePlan.preflight,
      memoryComponents: {
        ...sampleComputationalMergeDryRunResultV1.mergePlan.preflight.memoryComponents,
        totalEstimatedPeakBytes: 1,
      },
    },
  },
});

expectInvalid('computational merge blocked preflight without reasons', computationalMergeDryRunResultV1Schema, {
  ...sampleComputationalMergeDryRunResultV1,
  mergePlan: {
    ...sampleComputationalMergeDryRunResultV1.mergePlan,
    preflight: {
      ...sampleComputationalMergeDryRunResultV1.mergePlan.preflight,
      blockedReasons: [],
      status: 'blocked_plan_only',
      warningCodes: ['memory_budget_exceeded'],
    },
  },
});

expectInvalid(
  'computational merge preflight with mismatched output pixel count',
  computationalMergeDryRunResultV1Schema,
  {
    ...sampleComputationalMergeDryRunResultV1,
    mergePlan: {
      ...sampleComputationalMergeDryRunResultV1.mergePlan,
      preflight: {
        ...sampleComputationalMergeDryRunResultV1.mergePlan.preflight,
        geometryEstimate: {
          ...sampleComputationalMergeDryRunResultV1.mergePlan.preflight.geometryEstimate,
          outputPixelCount: 1,
        },
      },
    },
  },
);

expectInvalid('panorama artifact with output artifacts before render', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  provenance: {
    ...samplePanoramaArtifactV1.provenance,
    runtimeStatus: 'dry_run_planned',
  },
});

expectInvalid('panorama artifact rendered without output artifacts', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  outputArtifacts: [],
});

expectInvalid('panorama artifact with mismatched projection summary', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  projection: 'cylindrical',
});

expectInvalid('panorama artifact with unsupported implemented auto crop', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  engine: {
    ...samplePanoramaArtifactV1.engine,
    capabilities: {
      ...samplePanoramaArtifactV1.engine.capabilities,
      autoCrop: false,
    },
  },
});

expectInvalid('panorama artifact with mismatched source count', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  validationMetrics: {
    ...samplePanoramaArtifactV1.validationMetrics,
    sourceCount: samplePanoramaArtifactV1.sourceImageRefs.length - 1,
  },
});

expectInvalid('panorama artifact with duplicate source indexes', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  sourceImageRefs: samplePanoramaArtifactV1.sourceImageRefs.map((source) => ({
    ...source,
    sourceIndex: 0,
  })),
});

expectInvalid('panorama artifact with scalar exposure gain missing applied details', panoramaArtifactV1Schema, {
  ...samplePanoramaArtifactV1,
  engine: {
    ...samplePanoramaArtifactV1.engine,
    capabilities: {
      ...samplePanoramaArtifactV1.engine.capabilities,
      exposureNormalization: true,
    },
  },
  exposureNormalization: {
    mode: 'scalar_overlap_luminance_gain_v1',
    support: 'implemented_current_engine',
  },
});

expectEqual(
  'panorama sample artifact and backend capability report share capabilities',
  samplePanoramaArtifactV1.engine.capabilities,
  samplePanoramaBackendCapabilityReportV1.capabilities,
);

expectInvalid('panorama backend with leaking backend types', panoramaBackendCapabilityReportV1Schema, {
  ...samplePanoramaBackendCapabilityReportV1,
  schemaBoundary: {
    ...samplePanoramaBackendCapabilityReportV1.schemaBoundary,
    backendTypesLeakIntoArtifacts: true,
  },
});

expectInvalid('external panorama backend required before packaging proof', panoramaBackendCapabilityReportV1Schema, {
  ...samplePanoramaBackendCapabilityReportV1,
  backendId: 'opencv_stitching_spike',
  ciPolicy: {
    defaultRequiredCiAllowed: true,
    requiredCiBlockers: [],
    suggestedCiTier: 'required_pr',
  },
  macosPackagingStatus: 'system_dependency_spike',
  qualityTier: 'optional_spike',
  runtimeRequirements: {
    externalLibraries: ['opencv', 'libclang'],
    requiresExternalLibraries: true,
    requiresNetworkAtRuntime: false,
  },
  status: 'optional_spike',
  supportedBlendModes: ['feather', 'multi_band'],
  supportedExposureModes: ['opencv_gain', 'opencv_channels'],
  supportedSeamMethods: ['opencv_graph_cut_color', 'opencv_voronoi'],
  warnings: ['external_dependency', 'packaging_unproven', 'required_ci_not_ready'],
});

expectInvalid('eligible super-resolution summary with block codes', superResolutionDryRunSummaryV1Schema, {
  ...sampleSuperResolutionDryRunSummaryV1,
  blockCodes: ['insufficient_overlap'],
});

expectInvalid('blocked super-resolution summary without block codes', superResolutionDryRunSummaryV1Schema, {
  ...sampleSuperResolutionDryRunSummaryV1,
  decisionStatus: 'blocked',
});

expectInvalid('super-resolution summary with effective scale above request', superResolutionDryRunSummaryV1Schema, {
  ...sampleSuperResolutionDryRunSummaryV1,
  effectiveOutputScale: sampleSuperResolutionDryRunSummaryV1.requestedOutputScale + 0.25,
});

expectInvalid('super-resolution summary with duplicate source state indexes', superResolutionDryRunSummaryV1Schema, {
  ...sampleSuperResolutionDryRunSummaryV1,
  sourceState: sampleSuperResolutionDryRunSummaryV1.sourceState.map((sourceState) => ({
    ...sourceState,
    sourceIndex: 0,
  })),
});

expectInvalid('super-resolution summary with mismatched source count', superResolutionDryRunSummaryV1Schema, {
  ...sampleSuperResolutionDryRunSummaryV1,
  validationSummary: {
    ...sampleSuperResolutionDryRunSummaryV1.validationSummary,
    sourceCount: sampleSuperResolutionDryRunSummaryV1.validationSummary.sourceCount - 1,
  },
});

expectInvalid('super-resolution artifact with aggressive preview-only detail', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  detailPolicy: 'aggressive_preview_only',
});

expectInvalid('super-resolution artifact without durable output artifact', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  outputArtifact: {
    ...sampleSuperResolutionArtifactV1.outputArtifact,
    storage: 'temp_cache',
  },
});

expectInvalid('model-backed super-resolution artifact without model provenance', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  engine: {
    backendType: 'local_model',
    engineId: 'rawengine_sr_model_backend',
    engineVersion: '0.1.0-schema',
  },
});

expectInvalid('non-model super-resolution artifact with model provenance', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  engine: {
    ...sampleSuperResolutionArtifactV1.engine,
    model: {
      modelId: 'rawengine_sr_model_preview',
      modelVersion: '0.0.1',
    },
  },
});

expectInvalid('current super-resolution artifact with invalidation reasons', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  staleState: {
    ...sampleSuperResolutionArtifactV1.staleState,
    invalidationReasons: ['source_content_hash_changed'],
  },
});

expectInvalid('stale super-resolution artifact without invalidation reasons', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  staleState: {
    ...sampleSuperResolutionArtifactV1.staleState,
    state: 'stale',
  },
});

expectInvalid('super-resolution artifact with source state missing a source', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  sourceState: sampleSuperResolutionArtifactV1.sourceState.slice(1),
});

expectInvalid('super-resolution artifact with unknown source state index', superResolutionArtifactV1Schema, {
  ...sampleSuperResolutionArtifactV1,
  sourceState: sampleSuperResolutionArtifactV1.sourceState.map((sourceState, sourceIndex) => ({
    ...sourceState,
    sourceIndex: sourceIndex === 0 ? 99 : sourceState.sourceIndex,
  })),
});

expectInvalid('HDR artifact with non-HDR source role', hdrMergeArtifactV1Schema, {
  ...sampleHdrMergeArtifactV1,
  sourceImageRefs: sampleHdrMergeArtifactV1.sourceImageRefs.map((source, sourceIndex) => ({
    ...source,
    role: sourceIndex === 0 ? 'panorama_tile' : source.role,
  })),
});

expectInvalid('HDR artifact without durable merge output', hdrMergeArtifactV1Schema, {
  ...sampleHdrMergeArtifactV1,
  outputArtifact: {
    ...sampleHdrMergeArtifactV1.outputArtifact,
    storage: 'temp_cache',
  },
});

expectInvalid('scene-linear HDR artifact with display-only output', hdrMergeArtifactV1Schema, {
  ...sampleHdrMergeArtifactV1,
  outputEncoding: 'display_referred_preview',
});

expectInvalid('current HDR artifact with invalidation reasons', hdrMergeArtifactV1Schema, {
  ...sampleHdrMergeArtifactV1,
  staleState: {
    ...sampleHdrMergeArtifactV1.staleState,
    invalidationReasons: ['source_content_hash_changed'],
  },
});

expectInvalid('HDR artifact with source state missing a source', hdrMergeArtifactV1Schema, {
  ...sampleHdrMergeArtifactV1,
  sourceState: sampleHdrMergeArtifactV1.sourceState.slice(1),
});

expectInvalid('HDR merge command without bracket exposure metadata', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeCommandEnvelopeV1,
  commandType: 'computationalMerge.createHdr',
  parameters: {
    alignmentMode: 'auto',
    bracketValidation: 'required',
    deghosting: 'medium',
    maxPreviewDimensionPx: 2048,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Interior HDR',
    qualityPreference: 'balanced',
    sources: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.map((source) => ({
      ...source,
      exposureEv: undefined,
      role: 'hdr_bracket',
    })),
    toneMapPreview: true,
  },
});

expectInvalid('super-resolution merge command with invalid scale', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeCommandEnvelopeV1,
  commandType: 'computationalMerge.createSuperResolution',
  parameters: {
    alignmentMode: 'optical_flow',
    detailPolicy: 'conservative',
    maxPreviewDimensionPx: 2048,
    mode: 'multi_image',
    outputName: 'Burst Super Resolution',
    outputScale: 8,
    qualityPreference: 'best',
    sources: sampleComputationalMergeCommandEnvelopeV1.parameters.sources.map((source) => ({
      ...source,
      role: 'sr_frame',
    })),
  },
});

expectInvalid(
  'single-image super-resolution command with multiple sources',
  computationalMergeCommandEnvelopeV1Schema,
  {
    ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
    parameters: {
      ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters,
      alignmentMode: 'none',
      mode: 'single_image',
    },
  },
);

expectInvalid('single-image super-resolution command with alignment', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1.parameters,
    alignmentMode: 'optical_flow',
  },
});

expectInvalid('multi-image super-resolution command with one source', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1.parameters,
    alignmentMode: 'optical_flow',
    mode: 'multi_image',
  },
});

expectInvalid('multi-image super-resolution command without alignment', computationalMergeCommandEnvelopeV1Schema, {
  ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  parameters: {
    ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters,
    alignmentMode: 'none',
  },
});

expectInvalid(
  'super-resolution apply command with aggressive preview-only detail policy',
  computationalMergeCommandEnvelopeV1Schema,
  {
    ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
    approval: {
      approvalClass: 'edit_apply',
      reason: 'Applying an accepted super-resolution merge creates a derived editable asset.',
      state: 'approved',
    },
    dryRun: false,
    parameters: {
      ...sampleComputationalMergeSuperResolutionCommandEnvelopeV1.parameters,
      acceptedDryRunPlanHash: 'sha256:sample-super-resolution-plan',
      acceptedDryRunPlanId: 'merge_plan_super_resolution_001',
      detailPolicy: 'aggressive_preview_only',
    },
  },
);

const invalidFilmLookCatalog = {
  ...sampleFilmLookCatalogV1,
  looks: [
    {
      ...sampleFilmLookCatalogV1.looks[0],
      displayName: 'Kodak Exact Clone',
    },
  ],
};

expectInvalid('film look catalog with unsafe exact stock claim', filmLookCatalogV1Schema, invalidFilmLookCatalog);

const invalidAcquisitionProfile = {
  ...sampleNegativeAcquisitionProfileV1,
  extra: 'reject unknown acquisition profile fields',
};

const invalidAcquisitionResult = negativeAcquisitionProfileV1Schema.safeParse(invalidAcquisitionProfile);
if (invalidAcquisitionResult.success) {
  throw new Error('Expected negative acquisition profile schema to reject unknown fields.');
}

const invalidFilmGrainMissingContribution = {
  ...sampleFilmGrainModelV1,
  channelSeparation: {
    ...sampleFilmGrainModelV1.channelSeparation,
    chromaAmount: 0,
    lumaAmount: 0,
  },
};
expectInvalid(
  'film grain model without luma or chroma contribution',
  filmGrainModelV1Schema,
  invalidFilmGrainMissingContribution,
);

const invalidFilmGrainSeedPolicy = {
  ...sampleFilmGrainModelV1,
  seedPolicy: {
    mode: 'explicit_seed',
  },
};
expectInvalid('film grain explicit seed policy without seed', filmGrainModelV1Schema, invalidFilmGrainSeedPolicy);

const invalidFilmGrainToneBand = {
  ...sampleFilmGrainModelV1,
  toneResponse: {
    ...sampleFilmGrainModelV1.toneResponse,
    highlight: {
      ...sampleFilmGrainModelV1.toneResponse.highlight,
      endLuma: 0.7,
      startLuma: 0.9,
    },
  },
};
expectInvalid('film grain tone band with inverted luma range', filmGrainModelV1Schema, invalidFilmGrainToneBand);

const invalidFilmBlackAndWhiteMixer = {
  ...sampleFilmBlackAndWhiteModelV1,
  channelMixer: {
    ...sampleFilmBlackAndWhiteModelV1.channelMixer,
    blueWeight: 0,
    greenWeight: 0,
    redWeight: 0,
  },
};
expectInvalid(
  'black-and-white model without channel contribution',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteMixer,
);

const invalidFilmBlackAndWhiteCustomFilter = {
  ...sampleFilmBlackAndWhiteModelV1,
  filterResponse: {
    preset: 'custom',
    strength: 70,
  },
};
expectInvalid(
  'black-and-white custom filter without hue',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteCustomFilter,
);

const invalidFilmBlackAndWhiteFilterNoneStrength = {
  ...sampleFilmBlackAndWhiteModelV1,
  filterResponse: {
    preset: 'none',
    strength: 30,
  },
};
expectInvalid(
  'black-and-white filter none with non-zero strength',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteFilterNoneStrength,
);

const invalidFilmBlackAndWhitePresetCustomHue = {
  ...sampleFilmBlackAndWhiteModelV1,
  filterResponse: {
    customHueDegrees: 45,
    preset: 'yellow_filter',
    strength: 45,
  },
};
expectInvalid(
  'black-and-white preset filter with custom hue',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhitePresetCustomHue,
);

const invalidFilmBlackAndWhiteTonePoints = {
  ...sampleFilmBlackAndWhiteModelV1,
  luminanceCurve: {
    ...sampleFilmBlackAndWhiteModelV1.luminanceCurve,
    blackPoint: 0.8,
    whitePoint: 0.2,
  },
};
expectInvalid(
  'black-and-white luminance curve with inverted black and white points',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteTonePoints,
);

const invalidFilmBlackAndWhiteToning = {
  ...sampleFilmBlackAndWhiteModelV1,
  toning: {
    ...sampleFilmBlackAndWhiteModelV1.toning,
    mode: 'none',
    strength: 20,
  },
};
expectInvalid(
  'black-and-white toning strength without toning mode',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteToning,
);

const invalidFilmBlackAndWhitePaperTint = {
  ...sampleFilmBlackAndWhiteModelV1,
  toning: {
    balance: 0,
    mode: 'paper_tint',
    strength: 18,
  },
};
expectInvalid(
  'black-and-white paper tint without tint payload',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhitePaperTint,
);

const invalidFilmBlackAndWhiteSplitTone = {
  ...sampleFilmBlackAndWhiteModelV1,
  toning: {
    balance: 0,
    mode: 'split_tone',
    shadowHueDegrees: 220,
    strength: 25,
  },
};
expectInvalid(
  'black-and-white split tone without highlight hue',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteSplitTone,
);

const invalidFilmBlackAndWhiteSplitToneStrength = {
  ...sampleFilmBlackAndWhiteModelV1,
  toning: {
    balance: 0,
    highlightHueDegrees: 48,
    mode: 'split_tone',
    shadowHueDegrees: 220,
    strength: 0,
  },
};
expectInvalid(
  'black-and-white split tone with zero strength',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteSplitToneStrength,
);

const invalidFilmBlackAndWhiteRendererSupport = {
  ...sampleFilmBlackAndWhiteModelV1,
  rendererSupport: 'implemented_current_engine',
};
expectInvalid(
  'black-and-white model claiming full renderer support before implementation',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteRendererSupport,
);

const invalidFilmBlackAndWhiteDisplayWarning = {
  ...sampleFilmBlackAndWhiteModelV1,
  renderDomain: 'display_referred',
  warningCodes: sampleFilmBlackAndWhiteModelV1.warningCodes.filter((code) => code !== 'display_referred_input'),
};
expectInvalid(
  'display-referred black-and-white model without warning',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteDisplayWarning,
);

const invalidFilmBlackAndWhiteResponseWarning = {
  ...sampleFilmBlackAndWhiteModelV1,
  warningCodes: sampleFilmBlackAndWhiteModelV1.warningCodes.filter(
    (code) => code !== 'creative_not_measured_stock_response',
  ),
};
expectInvalid(
  'black-and-white response family without measured-stock disclaimer warning',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteResponseWarning,
);

const invalidFilmBlackAndWhiteToningWarning = {
  ...sampleFilmBlackAndWhiteModelV1,
  warningCodes: sampleFilmBlackAndWhiteModelV1.warningCodes.filter((code) => code !== 'toning_not_measured_paper'),
};
expectInvalid(
  'black-and-white toning without paper disclaimer warning',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteToningWarning,
);

const invalidFilmBlackAndWhiteUnknownField = {
  ...sampleFilmBlackAndWhiteModelV1,
  stockName: 'not allowed',
};
expectInvalid(
  'black-and-white model with stock-specific unknown field',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteUnknownField,
);

const invalidFilmBlackAndWhiteHalationLeak = {
  ...sampleFilmBlackAndWhiteModelV1,
  spectralBias: {
    redGain: 1,
  },
};
expectInvalid(
  'black-and-white model with halation spectral-bias field',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteHalationLeak,
);

const invalidFilmBlackAndWhiteNegativeLabLeak = {
  ...sampleFilmBlackAndWhiteModelV1,
  processFamily: 'black_and_white_silver_negative',
};
expectInvalid(
  'black-and-white model with Negative Lab process-family field',
  filmBlackAndWhiteModelV1Schema,
  invalidFilmBlackAndWhiteNegativeLabLeak,
);

const invalidFilmHalationThreshold = {
  ...sampleFilmHalationModelV1,
  sourceIsolation: {
    ...sampleFilmHalationModelV1.sourceIsolation,
    thresholdEnd: 0.65,
    thresholdStart: 0.9,
  },
};
expectInvalid(
  'film halation model with inverted highlight threshold',
  filmHalationModelV1Schema,
  invalidFilmHalationThreshold,
);

const invalidFilmHalationRadius = {
  ...sampleFilmHalationModelV1,
  geometry: {
    ...sampleFilmHalationModelV1.geometry,
    coreRadiusPx: 48,
    fringeRadiusPx: 24,
  },
};
expectInvalid(
  'film halation model with fringe radius below core radius',
  filmHalationModelV1Schema,
  invalidFilmHalationRadius,
);

const invalidFilmHalationSpectralBias = {
  ...sampleFilmHalationModelV1,
  spectralBias: {
    ...sampleFilmHalationModelV1.spectralBias,
    blueGain: 1,
    greenGain: 1,
    orangeGain: 0,
    redGain: 0,
  },
};
expectInvalid(
  'film halation model without warm spectral bias',
  filmHalationModelV1Schema,
  invalidFilmHalationSpectralBias,
);

const invalidFilmHalationRendererSupport = {
  ...sampleFilmHalationModelV1,
  algorithm: 'spectral_highlight_halation_v1',
  rendererSupport: 'implemented_current_engine',
};
expectInvalid(
  'film halation model claiming full renderer support before implementation',
  filmHalationModelV1Schema,
  invalidFilmHalationRendererSupport,
);

const invalidFilmHalationZeroAmount = {
  ...sampleFilmHalationModelV1,
  intensity: {
    ...sampleFilmHalationModelV1.intensity,
    amount: 0,
  },
};
expectInvalid('film halation model with zero amount', filmHalationModelV1Schema, invalidFilmHalationZeroAmount);

const invalidFilmHalationMaskBehavior = {
  ...sampleFilmHalationModelV1,
  maskBehavior: {
    ...sampleFilmHalationModelV1.maskBehavior,
    avoidLayerDoubleCounting: false,
  },
};
expectInvalid(
  'mask-compatible film halation model without double-counting protection',
  filmHalationModelV1Schema,
  invalidFilmHalationMaskBehavior,
);

const invalidFilmHalationDisplayWarning = {
  ...sampleFilmHalationModelV1,
  renderDomain: 'display_referred',
  warningCodes: sampleFilmHalationModelV1.warningCodes.filter((code) => code !== 'display_referred_input'),
};
expectInvalid(
  'display-referred film halation model without warning',
  filmHalationModelV1Schema,
  invalidFilmHalationDisplayWarning,
);

const invalidFilmHalationDeterministicPolicy = {
  ...sampleFilmHalationModelV1,
  deterministic: {
    deterministicReplay: false,
    stochasticInputs: true,
  },
};
expectInvalid(
  'film halation model with stochastic deterministic policy',
  filmHalationModelV1Schema,
  invalidFilmHalationDeterministicPolicy,
);

const invalidFilmHalationUnknownField = {
  ...sampleFilmHalationModelV1,
  spectralNanometers: [620, 650],
};
expectInvalid('film halation model with unknown field', filmHalationModelV1Schema, invalidFilmHalationUnknownField);

const invalidFilmGlowMissingContribution = {
  ...sampleFilmGlowModelV1,
  intensity: {
    ...sampleFilmGlowModelV1.intensity,
    bloomAmount: 0,
    glowAmount: 0,
  },
};
expectInvalid(
  'film glow model without bloom or glow contribution',
  filmGlowModelV1Schema,
  invalidFilmGlowMissingContribution,
);

const invalidFilmGlowThreshold = {
  ...sampleFilmGlowModelV1,
  sourceIsolation: {
    ...sampleFilmGlowModelV1.sourceIsolation,
    thresholdEnd: 0.58,
    thresholdStart: 0.82,
  },
};
expectInvalid('film glow model with inverted highlight threshold', filmGlowModelV1Schema, invalidFilmGlowThreshold);

const invalidFilmGlowRadiusCap = {
  ...sampleFilmGlowModelV1,
  qualityPolicy: {
    ...sampleFilmGlowModelV1.qualityPolicy,
    maxExportRadiusPx: 32,
  },
};
expectInvalid('film glow model with export radius below blur radius', filmGlowModelV1Schema, invalidFilmGlowRadiusCap);

const invalidFilmGlowMaskBehavior = {
  ...sampleFilmGlowModelV1,
  maskBehavior: {
    ...sampleFilmGlowModelV1.maskBehavior,
    avoidLayerDoubleCounting: false,
  },
};
expectInvalid(
  'mask-compatible film glow model without double-counting protection',
  filmGlowModelV1Schema,
  invalidFilmGlowMaskBehavior,
);

const invalidFilmGlowMaskEdgeStabilization = {
  ...sampleFilmGlowModelV1,
  maskBehavior: {
    ...sampleFilmGlowModelV1.maskBehavior,
    stabilizeMaskEdgesBeforeBlur: false,
  },
};
expectInvalid(
  'mask-compatible film glow model without mask-edge stabilization',
  filmGlowModelV1Schema,
  invalidFilmGlowMaskEdgeStabilization,
);

const invalidFilmGlowRendererSupport = {
  ...sampleFilmGlowModelV1,
  rendererSupport: 'implemented_current_engine',
};
expectInvalid(
  'film glow model claiming full renderer support before implementation',
  filmGlowModelV1Schema,
  invalidFilmGlowRendererSupport,
);

const invalidFilmGlowDisplayWarning = {
  ...sampleFilmGlowModelV1,
  renderDomain: 'display_referred',
  warningCodes: sampleFilmGlowModelV1.warningCodes.filter((code) => code !== 'display_referred_input'),
};
expectInvalid('display-referred film glow model without warning', filmGlowModelV1Schema, invalidFilmGlowDisplayWarning);

const invalidFilmGlowPreviewApproximationWarning = {
  ...sampleFilmGlowModelV1,
  blurPolicy: {
    ...sampleFilmGlowModelV1.blurPolicy,
    radiusPx: 96,
  },
  warningCodes: sampleFilmGlowModelV1.warningCodes.filter((code) => code !== 'wide_radius_preview_approximation'),
};
expectInvalid(
  'film glow model with preview radius approximation without warning',
  filmGlowModelV1Schema,
  invalidFilmGlowPreviewApproximationWarning,
);

const invalidFilmGlowWideRadiusWarning = {
  ...sampleFilmGlowModelV1,
  blurPolicy: {
    ...sampleFilmGlowModelV1.blurPolicy,
    radiusPx: 320,
  },
  qualityPolicy: {
    ...sampleFilmGlowModelV1.qualityPolicy,
    maxExportRadiusPx: 384,
  },
  warningCodes: sampleFilmGlowModelV1.warningCodes.filter((code) => code !== 'wide_radius_performance_risk'),
};
expectInvalid(
  'wide-radius film glow model without performance warning',
  filmGlowModelV1Schema,
  invalidFilmGlowWideRadiusWarning,
);

const invalidFilmGlowAdditiveClippingWarning = {
  ...sampleFilmGlowModelV1,
  blendMode: 'linear_add_limited',
  intensity: {
    ...sampleFilmGlowModelV1.intensity,
    opacity: 82,
  },
  warningCodes: sampleFilmGlowModelV1.warningCodes.filter((code) => code !== 'clipping_risk'),
};
expectInvalid(
  'high-opacity additive film glow model without clipping warning',
  filmGlowModelV1Schema,
  invalidFilmGlowAdditiveClippingWarning,
);

const invalidFilmGlowDeterministicPolicy = {
  ...sampleFilmGlowModelV1,
  deterministic: {
    deterministicReplay: false,
    stochasticInputs: true,
  },
};
expectInvalid(
  'film glow model with stochastic deterministic policy',
  filmGlowModelV1Schema,
  invalidFilmGlowDeterministicPolicy,
);

const invalidFilmGlowUnknownField = {
  ...sampleFilmGlowModelV1,
  halationRedGain: 1,
};
expectInvalid('film glow model with halation-style unknown field', filmGlowModelV1Schema, invalidFilmGlowUnknownField);

const invalidNegativeLabCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabCommandEnvelopeV1.parameters,
    unexpectedParameter: true,
  },
};

const invalidNegativeLabCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidNegativeLabCommand);
if (invalidNegativeLabCommandResult.success) {
  throw new Error('Expected negative lab command schema to reject unknown parameter fields.');
}

const invalidFrameQcCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  commandType: 'negativeLab.setFrameQcStatus',
  parameters: {
    acknowledgedWarningCodes: [],
    frameId: 'frame_0001',
    qcStatus: 'approved',
    sessionId: 'negative_roll_session_sample',
    warningCodes: ['lossy_input'],
  },
};

const invalidFrameQcCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidFrameQcCommand);
if (invalidFrameQcCommandResult.success) {
  throw new Error('Expected frame QC command schema to reject generated warningCodes as user input.');
}

if (sampleNegativeLabApplyFrameCropCommandEnvelopeV1.commandType !== 'negativeLab.applyFrameCrop') {
  throw new Error('Expected frame crop command sample to use negativeLab.applyFrameCrop.');
}

const [sampleFrameCropEdit] = sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters.cropEdits;
if (sampleFrameCropEdit === undefined) {
  throw new Error('Expected frame crop command sample to include a crop edit.');
}

const invalidFrameCropDuplicateFrames = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [sampleFrameCropEdit, sampleFrameCropEdit],
  },
};
expectInvalid(
  'frame crop command with duplicate frame edits',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropDuplicateFrames,
);

const invalidFrameCropMissingDetectionRun = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    detectionRunId: undefined,
  },
};
expectInvalid(
  'detected frame crop command without detection run ID',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropMissingDetectionRun,
);

const invalidFrameCropAcceptedManualSource = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        cropSource: 'manual_override',
      },
    ],
  },
};
expectInvalid(
  'accepted detected frame crop command with manual crop source',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropAcceptedManualSource,
);

const invalidFrameCropManualDetectedSource = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        cropSource: 'detected_frame',
        editMode: 'manual_override',
      },
    ],
  },
};
expectInvalid(
  'manual frame crop override recorded as detected crop',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropManualDetectedSource,
);

const invalidFrameCropRejectedWithoutNotes = {
  ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabApplyFrameCropCommandEnvelopeV1.parameters,
    cropEdits: [
      {
        ...sampleFrameCropEdit,
        editMode: 'reject_detected',
        notes: undefined,
      },
    ],
  },
};
expectInvalid(
  'rejected frame crop command without review notes',
  negativeLabCommandEnvelopeV1Schema,
  invalidFrameCropRejectedWithoutNotes,
);

const invalidDeferredProcessCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleNegativeLabCommandEnvelopeV1.parameters,
    processFamily: 'ecn2_color_negative',
  },
};

const invalidDeferredProcessCommandResult = negativeLabCommandEnvelopeV1Schema.safeParse(invalidDeferredProcessCommand);
if (invalidDeferredProcessCommandResult.success) {
  throw new Error('Expected negative lab v1 command schema to reject deferred process families.');
}

const invalidMutatingAppServerToolManifest = {
  ...sampleNegativeLabAppServerToolManifestV1,
  tools: [
    {
      ...sampleNegativeLabAppServerToolManifestV1.tools[0],
      approvalClass: 'preview_only',
      executionMode: 'apply_dry_run_plan',
      inputSchemaName: 'NegativeLabCommandEnvelopeV1',
      mutates: true,
      requiresDryRunPlan: false,
    },
  ],
};

const invalidMutatingAppServerToolResult = negativeLabAppServerToolManifestV1Schema.safeParse(
  invalidMutatingAppServerToolManifest,
);
if (invalidMutatingAppServerToolResult.success) {
  throw new Error('Expected mutating app-server tool manifests to require edit approval and a dry-run plan.');
}

const invalidComputationalMergeRemoteManifest = {
  ...sampleComputationalMergeAppServerToolManifestV1,
  tools: [
    {
      ...sampleComputationalMergeAppServerToolManifestV1.tools[0],
      localOnly: false,
    },
  ],
};
expectInvalid(
  'remote computational merge app-server tool manifest',
  computationalMergeAppServerToolManifestV1Schema,
  invalidComputationalMergeRemoteManifest,
);

const invalidComputationalMergeApplyManifest = {
  ...sampleComputationalMergeAppServerToolManifestV1,
  tools: [
    {
      ...sampleComputationalMergeAppServerToolManifestV1.tools[1],
      mutates: true,
      recordsProvenance: false,
      requiresDryRunPlan: false,
    },
  ],
};
expectInvalid(
  'computational merge apply manifest without provenance or dry-run plan',
  computationalMergeAppServerToolManifestV1Schema,
  invalidComputationalMergeApplyManifest,
);

const invalidAiCloudLocalOnlyManifest = {
  ...sampleAiAppServerToolManifestV1,
  tools: [
    {
      ...sampleAiAppServerToolManifestV1.tools[0],
      allowedProviderClasses: ['local_model', 'cloud_service'],
      localOnly: true,
    },
  ],
};

const invalidAiCloudLocalOnlyManifestResult = aiAppServerToolManifestV1Schema.safeParse(
  invalidAiCloudLocalOnlyManifest,
);
if (invalidAiCloudLocalOnlyManifestResult.success) {
  throw new Error('Expected local-only AI app-server manifests to reject cloud-service providers.');
}

const invalidAiApplyToolManifest = {
  ...sampleAiAppServerToolManifestV1,
  tools: [
    {
      ...sampleAiAppServerToolManifestV1.tools[1],
      mutates: true,
      requiresDryRunPlan: false,
    },
  ],
};

const invalidAiApplyToolManifestResult = aiAppServerToolManifestV1Schema.safeParse(invalidAiApplyToolManifest);
if (invalidAiApplyToolManifestResult.success) {
  throw new Error('Expected AI apply app-server tools to require a dry-run plan.');
}

const invalidPositiveVariantProvenance = {
  ...sampleNegativeLabPositiveVariantProvenanceV1,
  sourceContentHash: '',
};

const invalidPositiveVariantProvenanceResult = negativeLabPositiveVariantProvenanceV1Schema.safeParse(
  invalidPositiveVariantProvenance,
);
if (invalidPositiveVariantProvenanceResult.success) {
  throw new Error('Expected positive variant provenance schema to reject missing source hashes.');
}

const invalidDensityNormalizationProfile = {
  ...sampleNegativeLabDensityNormalizationProfileV1,
  channelBalanceWeights: {
    blue: 0.5,
    green: 0.5,
    red: 0.5,
  },
};

const invalidDensityNormalizationProfileResult = negativeLabDensityNormalizationProfileV1Schema.safeParse(
  invalidDensityNormalizationProfile,
);
if (invalidDensityNormalizationProfileResult.success) {
  throw new Error('Expected density normalization profiles to reject channel weights that do not sum to 1.');
}

const invalidProcessProfile = {
  ...sampleNegativeLabProcessProfileV1,
  densityCurves: [
    {
      channel: 'red',
      interpolation: 'linear',
      points: [
        { inputDensity: 0, outputLinear: 0.2 },
        { inputDensity: 0.5, outputLinear: 0.1 },
      ],
    },
  ],
};

const invalidProcessProfileResult = negativeLabProcessProfileV1Schema.safeParse(invalidProcessProfile);
if (invalidProcessProfileResult.success) {
  throw new Error('Expected process profiles to reject non-monotonic density curves.');
}

const [sampleRedDensityCurve] = sampleNegativeLabProcessProfileV1.densityCurves;
if (sampleRedDensityCurve === undefined) {
  throw new Error('Expected process profile sample to include a red density curve.');
}

const invalidDuplicateInversionCurveSet = {
  ...sampleNegativeLabPerChannelInversionCurveSetV1,
  densityCurves: [sampleRedDensityCurve, sampleRedDensityCurve],
};
expectInvalid(
  'per-channel inversion curve set with duplicate channels',
  negativeLabPerChannelInversionCurveSetV1Schema,
  invalidDuplicateInversionCurveSet,
);

const invalidBlackAndWhiteInversionCurveSet = {
  ...sampleNegativeLabPerChannelInversionCurveSetV1,
  colorMode: 'black_and_white_luminance',
};
expectInvalid(
  'black-and-white inversion curve set with RGB curves',
  negativeLabPerChannelInversionCurveSetV1Schema,
  invalidBlackAndWhiteInversionCurveSet,
);

if (sampleNegativeLabCommandEnvelopeV1.commandType !== 'negativeLab.setConversionRecipe') {
  throw new Error('Expected command sample to use negativeLab.setConversionRecipe.');
}

const sampleConversionRecipeParameters = sampleNegativeLabCommandEnvelopeV1.parameters;
const curveModelWithoutInversionCurveSet = {
  curveFamily: sampleConversionRecipeParameters.curveModel.curveFamily,
  inversionCurveSetPolicy: 'use_curve_set_override',
  normalizationProfileId: sampleConversionRecipeParameters.curveModel.normalizationProfileId,
  normalizationProfileVersion: sampleConversionRecipeParameters.curveModel.normalizationProfileVersion,
  processProfileId: sampleConversionRecipeParameters.curveModel.processProfileId,
  processProfileVersion: sampleConversionRecipeParameters.curveModel.processProfileVersion,
};
const invalidCurveOverrideCommand = {
  ...sampleNegativeLabCommandEnvelopeV1,
  parameters: {
    ...sampleConversionRecipeParameters,
    curveModel: curveModelWithoutInversionCurveSet,
  },
};
expectInvalid(
  'curve override command without curve set',
  negativeLabCommandEnvelopeV1Schema,
  invalidCurveOverrideCommand,
);

const [sampleDetectedFrame] = sampleNegativeLabFrameDetectionResultV1.detectedFrames;
if (sampleDetectedFrame === undefined) {
  throw new Error('Expected frame detection sample to include a detected frame.');
}

const invalidFrameDetectionDuplicateId = {
  ...sampleNegativeLabFrameDetectionResultV1,
  detectedFrames: [
    sampleDetectedFrame,
    {
      ...sampleDetectedFrame,
      frameIndex: 1,
    },
  ],
};

const invalidFrameDetectionDuplicateIdResult = negativeLabFrameDetectionResultV1Schema.safeParse(
  invalidFrameDetectionDuplicateId,
);
if (invalidFrameDetectionDuplicateIdResult.success) {
  throw new Error('Expected frame detection results to reject duplicate frame IDs.');
}

const invalidFrameDetectionUnknownSource = {
  ...sampleNegativeLabFrameDetectionResultV1,
  detectedFrames: [
    {
      ...sampleDetectedFrame,
      sourceFileId: 'unknown_source_file',
    },
  ],
};

const invalidFrameDetectionUnknownSourceResult = negativeLabFrameDetectionResultV1Schema.safeParse(
  invalidFrameDetectionUnknownSource,
);
if (invalidFrameDetectionUnknownSourceResult.success) {
  throw new Error('Expected frame detection results to reject frames from unlisted source files.');
}

const invalidAcceptedBaseSampleWithoutStats = {
  ...sampleNegativeLabBaseSampleRecordV1,
  sampleStats: undefined,
};
expectInvalid(
  'accepted base sample without channel stats',
  negativeLabBaseSampleRecordV1Schema,
  invalidAcceptedBaseSampleWithoutStats,
);

const invalidRejectedBaseSampleWithoutReason = {
  ...sampleNegativeLabBaseSampleRecordV1,
  rejectionReason: undefined,
  sampleStats: undefined,
  status: 'rejected',
};
expectInvalid(
  'rejected base sample without reason',
  negativeLabBaseSampleRecordV1Schema,
  invalidRejectedBaseSampleWithoutReason,
);

const invalidBaseFogEstimateDuplicateSources = {
  ...sampleNegativeLabBaseFogEstimateV1,
  sourceSampleIds: [sampleNegativeLabBaseSampleRecordV1.sampleId, sampleNegativeLabBaseSampleRecordV1.sampleId],
};
expectInvalid(
  'base fog estimate with duplicate source samples',
  negativeLabBaseFogEstimateV1Schema,
  invalidBaseFogEstimateDuplicateSources,
);

const invalidBaseFogEstimateRejectedSource = {
  ...sampleNegativeLabBaseFogEstimateV1,
  rejectedSampleIds: [sampleNegativeLabBaseSampleRecordV1.sampleId],
};
expectInvalid(
  'base fog estimate using a rejected source sample',
  negativeLabBaseFogEstimateV1Schema,
  invalidBaseFogEstimateRejectedSource,
);

const invalidHighConfidenceBaseFogWarning = {
  ...sampleNegativeLabBaseFogEstimateV1,
  confidence: 'high',
  warningCodes: ['clipped_base_channel'],
};
expectInvalid(
  'high-confidence base fog estimate with confidence warning',
  negativeLabBaseFogEstimateV1Schema,
  invalidHighConfidenceBaseFogWarning,
);

const invalidOperationWrongStage = {
  ...sampleNegativeLabConversionOperationV1,
  operationStage: 'creative_rendering',
};
expectInvalid(
  'conversion operation with wrong stage',
  negativeLabConversionOperationV1Schema,
  invalidOperationWrongStage,
);

const invalidOperationWrongClass = {
  ...sampleNegativeLabConversionOperationV1,
  operationClass: 'creative',
};
expectInvalid(
  'conversion operation with wrong class',
  negativeLabConversionOperationV1Schema,
  invalidOperationWrongClass,
);

const invalidMutatingOperationWithoutApplyApproval = {
  ...sampleNegativeLabConversionOperationV1,
  changeSet: sampleNegativeLabApplyResultV1.changeSet,
  mutates: true,
  resultGraphRevision: sampleNegativeLabApplyResultV1.appliedGraphRevision,
};
expectInvalid(
  'mutating conversion operation without apply approval',
  negativeLabConversionOperationV1Schema,
  invalidMutatingOperationWithoutApplyApproval,
);

const invalidDryRunOperationWithChangeSet = {
  ...sampleNegativeLabConversionOperationV1,
  changeSet: sampleNegativeLabApplyResultV1.changeSet,
};
expectInvalid(
  'dry-run conversion operation with change set',
  negativeLabConversionOperationV1Schema,
  invalidDryRunOperationWithChangeSet,
);

const invalidPositiveVariantOperationWithoutOutputs = {
  ...sampleNegativeLabConversionOperationV1,
  artifactPurposes: ['editable_positive_variant'],
  commandType: 'negativeLab.createPositiveVariant',
  operationClass: 'output',
  operationStage: 'output_generation',
  outputArtifacts: [],
  parameterRefs: {
    ...sampleNegativeLabConversionOperationV1.parameterRefs,
    positiveVariantIds: [],
  },
};
expectInvalid(
  'positive variant operation without output artifact references',
  negativeLabConversionOperationV1Schema,
  invalidPositiveVariantOperationWithoutOutputs,
);

const [sampleBuiltInPreset, secondSampleBuiltInPreset] = sampleNegativeLabBuiltInPresetCatalogV1.presets;
if (sampleBuiltInPreset === undefined || secondSampleBuiltInPreset === undefined) {
  throw new Error('Expected built-in preset catalog sample to include at least two presets.');
}

const invalidGenericPresetManufacturerClaim = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      displayName: 'Kodak Portra 400',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with manufacturer or stock claims',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetManufacturerClaim,
);

const invalidGenericPresetUppercaseId = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      presetId: 'negative_lab.generic.C41.neutral.v1',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with uppercase preset IDs',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetUppercaseId,
);

const invalidGenericPresetDuplicateIds = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    sampleBuiltInPreset,
    {
      ...secondSampleBuiltInPreset,
      presetId: sampleBuiltInPreset.presetId,
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(2),
  ],
};
expectInvalid(
  'generic built-in preset catalog with duplicate preset IDs',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetDuplicateIds,
);

const invalidGenericPresetDuplicateDisplayNames = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    sampleBuiltInPreset,
    {
      ...secondSampleBuiltInPreset,
      displayName: sampleBuiltInPreset.displayName.toLocaleUpperCase('en-US'),
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(2),
  ],
};
expectInvalid(
  'generic built-in preset catalog with duplicate display names',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetDuplicateDisplayNames,
);

const invalidGenericPresetExactNameApproval = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      legalNamingStatus: 'approved_exact_stock_name',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with exact-stock naming status',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetExactNameApproval,
);

const invalidGenericPresetMeasuredProvenance = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      provenance: {
        ...sampleBuiltInPreset.provenance,
        measurementSource: 'project_owned_measurement',
      },
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with measured provenance',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetMeasuredProvenance,
);

const invalidGenericPresetProfileMismatch = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      processProfileId: 'generic_bw_silver_v1',
      processProfileVersion: '2026-06-13',
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with film class and process profile mismatches',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetProfileMismatch,
);

const invalidGenericPresetCreativeRendering = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      touchedParameters: {
        ...sampleBuiltInPreset.touchedParameters,
        creativeRendering: ['contrast_s_curve_v1'],
      },
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog with creative rendering defaults',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetCreativeRendering,
);

const invalidGenericPresetLabJpegWithoutWarnings = {
  ...sampleNegativeLabBuiltInPresetCatalogV1,
  presets: [
    {
      ...sampleBuiltInPreset,
      intendedInputModes: ['camera_raw', 'lab_jpeg'],
      requiredWarningCodes: [],
    },
    ...sampleNegativeLabBuiltInPresetCatalogV1.presets.slice(1),
  ],
};
expectInvalid(
  'generic built-in preset catalog that allows lab JPEG without required warnings',
  negativeLabBuiltInPresetCatalogV1Schema,
  invalidGenericPresetLabJpegWithoutWarnings,
);

const [
  sampleGenericPresetPolicy,
  sampleStockFamilyPresetPolicy,
  sampleMeasuredPresetPolicy,
  sampleLicensedPresetPolicy,
  sampleBlockedPresetPolicy,
] = sampleNegativeLabPresetMetadataPolicyCatalogV1.policies;
if (
  sampleGenericPresetPolicy === undefined ||
  sampleStockFamilyPresetPolicy === undefined ||
  sampleMeasuredPresetPolicy === undefined ||
  sampleLicensedPresetPolicy === undefined ||
  sampleBlockedPresetPolicy === undefined
) {
  throw new Error('Expected preset metadata policy catalog sample to include all policy tiers.');
}

const invalidPresetPolicyGenericManufacturerClaim = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    {
      ...sampleGenericPresetPolicy,
      allowedClaims: {
        ...sampleGenericPresetPolicy.allowedClaims,
        manufacturerName: true,
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(1),
  ],
};
expectInvalid(
  'preset metadata policy catalog with generic manufacturer claims',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyGenericManufacturerClaim,
);

const invalidPresetPolicyStockFamilyWithoutCitations = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    sampleGenericPresetPolicy,
    {
      ...sampleStockFamilyPresetPolicy,
      sourceRequirements: {
        ...sampleStockFamilyPresetPolicy.sourceRequirements,
        sourceCitationIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(2),
  ],
};
expectInvalid(
  'preset metadata policy catalog with stock-family policy missing citations',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyStockFamilyWithoutCitations,
);

const invalidPresetPolicyMeasuredWithoutFixture = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 2),
    {
      ...sampleMeasuredPresetPolicy,
      sourceRequirements: {
        ...sampleMeasuredPresetPolicy.sourceRequirements,
        fixtureIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(3),
  ],
};
expectInvalid(
  'preset metadata policy catalog with measured policy missing fixture IDs',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyMeasuredWithoutFixture,
);

const invalidPresetPolicyLicensedWithoutLicense = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 3),
    {
      ...sampleLicensedPresetPolicy,
      sourceRequirements: {
        ...sampleLicensedPresetPolicy.sourceRequirements,
        licenseRecordIds: [],
      },
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(4),
  ],
};
expectInvalid(
  'preset metadata policy catalog with licensed exact policy missing license records',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyLicensedWithoutLicense,
);

const invalidPresetPolicyBlockedInNormalUi = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(0, 4),
    {
      ...sampleBlockedPresetPolicy,
      allowedUiContexts: ['negative_lab_workspace'],
    },
  ],
};
expectInvalid(
  'preset metadata policy catalog with blocked policy visible in normal UI',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyBlockedInNormalUi,
);

const invalidPresetPolicyDuplicateIds = {
  ...sampleNegativeLabPresetMetadataPolicyCatalogV1,
  policies: [
    sampleGenericPresetPolicy,
    {
      ...sampleStockFamilyPresetPolicy,
      policyId: sampleGenericPresetPolicy.policyId,
    },
    ...sampleNegativeLabPresetMetadataPolicyCatalogV1.policies.slice(2),
  ],
};
expectInvalid(
  'preset metadata policy catalog with duplicate policy IDs',
  negativeLabPresetMetadataPolicyCatalogV1Schema,
  invalidPresetPolicyDuplicateIds,
);

const [sampleNegativeLabInputProfile, secondSampleNegativeLabInputProfile] =
  sampleNegativeLabInputProfileCatalogV1.profiles;
if (sampleNegativeLabInputProfile === undefined || secondSampleNegativeLabInputProfile === undefined) {
  throw new Error('Expected input profile catalog sample to include at least two profiles.');
}

const invalidInputProfileDuplicateIds = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    sampleNegativeLabInputProfile,
    {
      ...secondSampleNegativeLabInputProfile,
      profileId: sampleNegativeLabInputProfile.profileId,
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(2),
  ],
};
expectInvalid(
  'negative lab input profile catalog with duplicate profile IDs',
  negativeLabInputProfileCatalogV1Schema,
  invalidInputProfileDuplicateIds,
);

const invalidInputProfileDefaultMode = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      defaultInputMode: 'lab_jpeg',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'negative lab input profile with unsupported default mode',
  negativeLabInputProfileCatalogV1Schema,
  invalidInputProfileDefaultMode,
);

const invalidCameraRawProfile = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      colorSpaceEncoding: 'display_referred_rgb',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'camera raw input profile with display-referred encoding',
  negativeLabInputProfileCatalogV1Schema,
  invalidCameraRawProfile,
);

const invalidLabRenderedProfileWarnings = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfileCatalogV1.profiles[3],
      requiredWarningCodes: [],
    },
  ],
};
expectInvalid(
  'lab-rendered input profile without required warnings',
  negativeLabInputProfileCatalogV1Schema,
  invalidLabRenderedProfileWarnings,
);

const invalidHighConfidenceAssumption = {
  ...sampleNegativeLabInputProfileCatalogV1,
  profiles: [
    {
      ...sampleNegativeLabInputProfile,
      inputProfileSource: 'assumed_display_profile',
    },
    ...sampleNegativeLabInputProfileCatalogV1.profiles.slice(1),
  ],
};
expectInvalid(
  'high-confidence input profile with assumed display profile source',
  negativeLabInputProfileCatalogV1Schema,
  invalidHighConfidenceAssumption,
);

const [sampleQcOverlay] = sampleNegativeLabQcProofArtifactV1.overlays;
if (sampleQcOverlay === undefined) {
  throw new Error('Expected QC proof sample to include an overlay.');
}

const [sampleQcFrameMetric] = sampleNegativeLabQcProofArtifactV1.rollConsistency.frameMetrics;
if (sampleQcFrameMetric === undefined) {
  throw new Error('Expected QC proof sample to include a roll consistency frame metric.');
}

const invalidQcOverlayFrame = {
  ...sampleNegativeLabQcProofArtifactV1,
  overlays: [
    {
      ...sampleQcOverlay,
      frameId: 'missing_frame',
    },
  ],
};

const invalidQcOverlayFrameResult = negativeLabQcProofArtifactV1Schema.safeParse(invalidQcOverlayFrame);
if (invalidQcOverlayFrameResult.success) {
  throw new Error('Expected QC proof artifacts to reject overlays for unlisted frames.');
}

const invalidQcMetricFrame = {
  ...sampleNegativeLabQcProofArtifactV1,
  rollConsistency: {
    ...sampleNegativeLabQcProofArtifactV1.rollConsistency,
    frameMetrics: [
      {
        ...sampleQcFrameMetric,
        frameId: 'missing_frame',
      },
    ],
  },
};

const invalidQcMetricFrameResult = negativeLabQcProofArtifactV1Schema.safeParse(invalidQcMetricFrame);
if (invalidQcMetricFrameResult.success) {
  throw new Error('Expected QC proof artifacts to reject roll metrics for unlisted frames.');
}

const [
  sampleRollBatchFrameDetectionStage,
  sampleRollBatchBaseStage,
  sampleRollBatchConversionStage,
  ...remainingSampleRollBatchStages
] = sampleNegativeLabRollBatchWorkflowV1.stagePlans;
const [sampleRollBatchFrameMetric] = sampleNegativeLabRollBatchWorkflowV1.rollConsistencyPreview.frameMetrics;
if (
  sampleRollBatchFrameDetectionStage === undefined ||
  sampleRollBatchBaseStage === undefined ||
  sampleRollBatchConversionStage === undefined ||
  sampleRollBatchFrameMetric === undefined
) {
  throw new Error('Expected roll batch workflow sample to include stages and frame metrics.');
}

const invalidRollBatchWorkflowRejectedFrames = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  batchPolicy: {
    ...sampleNegativeLabRollBatchWorkflowV1.batchPolicy,
    includeRejectedFrames: true,
  },
};
expectInvalid(
  'negative lab roll batch workflow that includes rejected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowRejectedFrames,
);

const invalidRollBatchWorkflowAnchorOutsideSelection = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  anchorFrameIds: ['missing_frame'],
};
expectInvalid(
  'negative lab roll batch workflow with anchor outside selected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowAnchorOutsideSelection,
);

const invalidRollBatchWorkflowMetricOutsideSelection = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  rollConsistencyPreview: {
    ...sampleNegativeLabRollBatchWorkflowV1.rollConsistencyPreview,
    frameMetrics: [
      {
        ...sampleRollBatchFrameMetric,
        frameId: 'missing_frame',
      },
    ],
  },
};
expectInvalid(
  'negative lab roll batch workflow with consistency metric outside selected frames',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowMetricOutsideSelection,
);

const invalidRollBatchWorkflowMissingRequiredStage = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: sampleNegativeLabRollBatchWorkflowV1.stagePlans.filter((stagePlan) => stagePlan.stage !== 'qc_review'),
};
expectInvalid(
  'negative lab roll batch workflow missing QC review stage',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowMissingRequiredStage,
);

const invalidRollBatchWorkflowDryRunReadyWithoutPlan = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: [
    sampleRollBatchFrameDetectionStage,
    sampleRollBatchBaseStage,
    {
      ...sampleRollBatchConversionStage,
      dryRunPlanIds: [],
    },
    ...remainingSampleRollBatchStages,
  ],
};
expectInvalid(
  'negative lab roll batch workflow dry-run stage without plan IDs',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowDryRunReadyWithoutPlan,
);

const invalidRollBatchWorkflowDuplicateStages = {
  ...sampleNegativeLabRollBatchWorkflowV1,
  stagePlans: [
    sampleRollBatchFrameDetectionStage,
    {
      ...sampleRollBatchBaseStage,
      stage: sampleRollBatchFrameDetectionStage.stage,
    },
    sampleRollBatchConversionStage,
    ...remainingSampleRollBatchStages,
  ],
};
expectInvalid(
  'negative lab roll batch workflow with duplicate stages',
  negativeLabRollBatchWorkflowV1Schema,
  invalidRollBatchWorkflowDuplicateStages,
);

const [sampleNegativeLabFixture, secondSampleNegativeLabFixture] = sampleNegativeLabFixtureManifestV1.entries;
if (sampleNegativeLabFixture === undefined || secondSampleNegativeLabFixture === undefined) {
  throw new Error('Expected negative lab fixture manifest sample to include at least two entries.');
}

const invalidFixtureDuplicateIds = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    sampleNegativeLabFixture,
    {
      ...secondSampleNegativeLabFixture,
      fixtureId: sampleNegativeLabFixture.fixtureId,
    },
  ],
};
expectInvalid(
  'negative lab fixture manifest with duplicate IDs',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureDuplicateIds,
);

const invalidApprovedFixtureWithoutReview = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      reviewedAt: undefined,
      reviewer: undefined,
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'approved negative lab fixture without review metadata',
  negativeLabFixtureManifestV1Schema,
  invalidApprovedFixtureWithoutReview,
);

const invalidPublicFixtureWithoutRights = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      derivativeDistributionAllowed: false,
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'public negative lab fixture without derivative rights',
  negativeLabFixtureManifestV1Schema,
  invalidPublicFixtureWithoutRights,
);

const invalidPublicSourceWithoutLicense = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      source: {
        copyrightOwner: 'Unknown source',
        sourceKind: 'permissive_public',
      },
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'negative lab fixture manifest with public source missing license evidence',
  negativeLabFixtureManifestV1Schema,
  invalidPublicSourceWithoutLicense,
);

const invalidFixtureProfileMeasurementUse = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      allowedValidationUses: ['profile_measurement'],
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'synthetic negative lab fixture used for profile measurement',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureProfileMeasurementUse,
);

const invalidFixtureLabJpegWarnings = {
  ...sampleNegativeLabFixtureManifestV1,
  entries: [
    {
      ...sampleNegativeLabFixture,
      expectedNegativeWarningCodes: [],
      fileFormat: 'jpeg',
      lossyCompression: true,
      scanInputMode: 'lab_jpeg',
    },
    ...sampleNegativeLabFixtureManifestV1.entries.slice(1),
  ],
};
expectInvalid(
  'negative lab lab-JPEG fixture without expected warnings',
  negativeLabFixtureManifestV1Schema,
  invalidFixtureLabJpegWarnings,
);

console.log(`Validated ${validSamples.length} RawEngine schema samples.`);
