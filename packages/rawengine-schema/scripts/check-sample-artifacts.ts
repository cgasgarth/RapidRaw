#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { format } from 'prettier';

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
  focusStackArtifactV1Schema,
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
} from '../src/rawEngineSchemas.ts';
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
  sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  sampleComputationalMergeSuperResolutionDryRunAppServerToolCallValidationV1,
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
  sampleLayerMaskCommandEnvelopeV1,
  sampleLayerMaskDryRunResultV1,
  sampleLayerMaskMutationResultV1,
  sampleLayerMaskRefineCommandEnvelopeV1,
  sampleNegativeAcquisitionProfileV1,
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
  sampleToneColorCommandEnvelopeV1,
  sampleToneColorDryRunResultV1,
  sampleToneColorMutationResultV1,
  sampleToolRegistryV1,
} from '../src/samplePayloads.ts';

const ROOT = process.cwd();

const sampleArtifacts = [
  {
    name: 'query envelope',
    path: 'packages/rawengine-schema/samples/query-envelope-v1.json',
    schema: queryEnvelopeV1Schema,
    value: sampleQueryEnvelopeV1,
  },
  {
    name: 'command envelope',
    path: 'packages/rawengine-schema/samples/command-envelope-v1.json',
    schema: commandEnvelopeV1Schema,
    value: sampleCommandEnvelopeV1,
  },
  {
    name: 'artifact handle',
    path: 'packages/rawengine-schema/samples/artifact-handle-v1.json',
    schema: artifactHandleV1Schema,
    value: sampleArtifactHandleV1,
  },
  {
    name: 'tool registry',
    path: 'packages/rawengine-schema/samples/tool-registry-v1.json',
    schema: rawEngineToolRegistryV1Schema,
    value: sampleToolRegistryV1,
  },
  {
    name: 'app-server tool call validation',
    path: 'packages/rawengine-schema/samples/app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleRawEngineAppServerToolCallValidationV1,
  },
  {
    name: 'agent replay fixture',
    path: 'packages/rawengine-schema/samples/agent-replay-fixture-v1.json',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleRawEngineAgentReplayFixtureV1,
  },
  {
    name: 'basic tone agent replay fixture',
    path: 'packages/rawengine-schema/samples/basic-tone-agent-replay-fixture-v1.json',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleBasicToneAgentReplayFixtureV1,
  },
  {
    name: 'AI tool command envelope',
    path: 'packages/rawengine-schema/samples/ai-tool-command-envelope-v1.json',
    schema: aiToolCommandEnvelopeV1Schema,
    value: sampleAiToolCommandEnvelopeV1,
  },
  {
    name: 'AI tool apply command envelope',
    path: 'packages/rawengine-schema/samples/ai-tool-apply-command-envelope-v1.json',
    schema: aiToolCommandEnvelopeV1Schema,
    value: sampleAiToolApplyCommandEnvelopeV1,
  },
  {
    name: 'AI tool dry-run result',
    path: 'packages/rawengine-schema/samples/ai-tool-dry-run-result-v1.json',
    schema: aiToolDryRunResultV1Schema,
    value: sampleAiToolDryRunResultV1,
  },
  {
    name: 'AI tool apply result',
    path: 'packages/rawengine-schema/samples/ai-tool-apply-result-v1.json',
    schema: aiToolApplyResultV1Schema,
    value: sampleAiToolApplyResultV1,
  },
  {
    name: 'AI tool agent replay fixture',
    path: 'packages/rawengine-schema/samples/ai-tool-agent-replay-fixture-v1.json',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleAiToolAgentReplayFixtureV1,
  },
  {
    name: 'AI app-server tool manifest',
    path: 'packages/rawengine-schema/samples/ai-app-server-tool-manifest-v1.json',
    schema: aiAppServerToolManifestV1Schema,
    value: sampleAiAppServerToolManifestV1,
  },
  {
    name: 'AI enhancement command envelope',
    path: 'packages/rawengine-schema/samples/ai-enhancement-command-envelope-v1.json',
    schema: aiEnhancementCommandEnvelopeV1Schema,
    value: sampleAiEnhancementCommandEnvelopeV1,
  },
  {
    name: 'AI enhancement apply command envelope',
    path: 'packages/rawengine-schema/samples/ai-enhancement-apply-command-envelope-v1.json',
    schema: aiEnhancementCommandEnvelopeV1Schema,
    value: sampleAiEnhancementApplyCommandEnvelopeV1,
  },
  {
    name: 'AI enhancement dry-run result',
    path: 'packages/rawengine-schema/samples/ai-enhancement-dry-run-result-v1.json',
    schema: aiEnhancementDryRunResultV1Schema,
    value: sampleAiEnhancementDryRunResultV1,
  },
  {
    name: 'AI enhancement apply result',
    path: 'packages/rawengine-schema/samples/ai-enhancement-apply-result-v1.json',
    schema: aiEnhancementApplyResultV1Schema,
    value: sampleAiEnhancementApplyResultV1,
  },
  {
    name: 'AI enhancement agent replay fixture',
    path: 'packages/rawengine-schema/samples/ai-enhancement-agent-replay-fixture-v1.json',
    schema: rawEngineAgentReplayFixtureV1Schema,
    value: sampleAiEnhancementAgentReplayFixtureV1,
  },
  {
    name: 'AI enhancement dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/ai-enhancement-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiEnhancementDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'AI enhancement apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/ai-enhancement-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiEnhancementApplyAppServerToolCallValidationV1,
  },
  {
    name: 'AI mask dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/ai-mask-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiMaskDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'AI mask apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/ai-mask-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleAiMaskApplyAppServerToolCallValidationV1,
  },
  {
    name: 'export command envelope',
    path: 'packages/rawengine-schema/samples/export-command-envelope-v1.json',
    schema: exportCommandEnvelopeV1Schema,
    value: sampleExportCommandEnvelopeV1,
  },
  {
    name: 'export apply command envelope',
    path: 'packages/rawengine-schema/samples/export-apply-command-envelope-v1.json',
    schema: exportCommandEnvelopeV1Schema,
    value: sampleExportApplyCommandEnvelopeV1,
  },
  {
    name: 'export dry-run result',
    path: 'packages/rawengine-schema/samples/export-dry-run-result-v1.json',
    schema: exportDryRunResultV1Schema,
    value: sampleExportDryRunResultV1,
  },
  {
    name: 'export apply result',
    path: 'packages/rawengine-schema/samples/export-apply-result-v1.json',
    schema: exportApplyResultV1Schema,
    value: sampleExportApplyResultV1,
  },
  {
    name: 'export dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/export-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleExportDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'export apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/export-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleExportApplyAppServerToolCallValidationV1,
  },
  {
    name: 'edit graph snapshot query',
    path: 'packages/rawengine-schema/samples/edit-graph-snapshot-query-v1.json',
    schema: editGraphSnapshotQueryV1Schema,
    value: sampleEditGraphSnapshotQueryV1,
  },
  {
    name: 'edit graph snapshot',
    path: 'packages/rawengine-schema/samples/edit-graph-snapshot-v1.json',
    schema: editGraphSnapshotV1Schema,
    value: sampleEditGraphSnapshotV1,
  },
  {
    name: 'edit graph command envelope',
    path: 'packages/rawengine-schema/samples/edit-graph-command-envelope-v1.json',
    schema: editGraphCommandEnvelopeV1Schema,
    value: sampleEditGraphCommandEnvelopeV1,
  },
  {
    name: 'edit graph dry-run result',
    path: 'packages/rawengine-schema/samples/edit-graph-dry-run-result-v1.json',
    schema: editGraphDryRunResultV1Schema,
    value: sampleEditGraphDryRunResultV1,
  },
  {
    name: 'edit graph mutation result',
    path: 'packages/rawengine-schema/samples/edit-graph-mutation-result-v1.json',
    schema: editGraphMutationResultV1Schema,
    value: sampleEditGraphMutationResultV1,
  },
  {
    name: 'tone color command envelope',
    path: 'packages/rawengine-schema/samples/tone-color-command-envelope-v1.json',
    schema: toneColorCommandEnvelopeV1Schema,
    value: sampleToneColorCommandEnvelopeV1,
  },
  {
    name: 'tone color dry-run result',
    path: 'packages/rawengine-schema/samples/tone-color-dry-run-result-v1.json',
    schema: toneColorDryRunResultV1Schema,
    value: sampleToneColorDryRunResultV1,
  },
  {
    name: 'tone color mutation result',
    path: 'packages/rawengine-schema/samples/tone-color-mutation-result-v1.json',
    schema: toneColorMutationResultV1Schema,
    value: sampleToneColorMutationResultV1,
  },
  {
    name: 'layer mask command envelope',
    path: 'packages/rawengine-schema/samples/layer-mask-command-envelope-v1.json',
    schema: layerMaskCommandEnvelopeV1Schema,
    value: sampleLayerMaskCommandEnvelopeV1,
  },
  {
    name: 'layer mask refine command envelope',
    path: 'packages/rawengine-schema/samples/layer-mask-refine-command-envelope-v1.json',
    schema: layerMaskCommandEnvelopeV1Schema,
    value: sampleLayerMaskRefineCommandEnvelopeV1,
  },
  {
    name: 'layer mask dry-run result',
    path: 'packages/rawengine-schema/samples/layer-mask-dry-run-result-v1.json',
    schema: layerMaskDryRunResultV1Schema,
    value: sampleLayerMaskDryRunResultV1,
  },
  {
    name: 'layer mask mutation result',
    path: 'packages/rawengine-schema/samples/layer-mask-mutation-result-v1.json',
    schema: layerMaskMutationResultV1Schema,
    value: sampleLayerMaskMutationResultV1,
  },
  {
    name: 'computational merge command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeCommandEnvelopeV1,
  },
  {
    name: 'computational merge HDR command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-hdr-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeHdrCommandEnvelopeV1,
  },
  {
    name: 'computational merge focus stack command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-focus-stack-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeFocusStackCommandEnvelopeV1,
  },
  {
    name: 'focus stack artifact',
    path: 'packages/rawengine-schema/samples/focus-stack-artifact-v1.json',
    schema: focusStackArtifactV1Schema,
    value: sampleFocusStackArtifactV1,
  },
  {
    name: 'HDR merge artifact',
    path: 'packages/rawengine-schema/samples/hdr-merge-artifact-v1.json',
    schema: hdrMergeArtifactV1Schema,
    value: sampleHdrMergeArtifactV1,
  },
  {
    name: 'computational merge focus stack apply command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-focus-stack-apply-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeFocusStackApplyCommandEnvelopeV1,
  },
  {
    name: 'computational merge super-resolution command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-super-resolution-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeSuperResolutionCommandEnvelopeV1,
  },
  {
    name: 'computational merge single-image super-resolution command envelope',
    path: 'packages/rawengine-schema/samples/computational-merge-single-image-super-resolution-command-envelope-v1.json',
    schema: computationalMergeCommandEnvelopeV1Schema,
    value: sampleComputationalMergeSingleImageSuperResolutionCommandEnvelopeV1,
  },
  {
    name: 'computational merge dry-run result',
    path: 'packages/rawengine-schema/samples/computational-merge-dry-run-result-v1.json',
    schema: computationalMergeDryRunResultV1Schema,
    value: sampleComputationalMergeDryRunResultV1,
  },
  {
    name: 'computational merge mutation result',
    path: 'packages/rawengine-schema/samples/computational-merge-mutation-result-v1.json',
    schema: computationalMergeMutationResultV1Schema,
    value: sampleComputationalMergeMutationResultV1,
  },
  {
    name: 'computational merge app-server tool manifest',
    path: 'packages/rawengine-schema/samples/computational-merge-app-server-tool-manifest-v1.json',
    schema: computationalMergeAppServerToolManifestV1Schema,
    value: sampleComputationalMergeAppServerToolManifestV1,
  },
  {
    name: 'computational merge panorama dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-panorama-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergePanoramaDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge panorama apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-panorama-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergePanoramaApplyAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge focus stack dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-focus-stack-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeFocusStackDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge focus stack apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-focus-stack-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeFocusStackApplyAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge super-resolution dry-run app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-super-resolution-dry-run-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeSuperResolutionDryRunAppServerToolCallValidationV1,
  },
  {
    name: 'computational merge super-resolution apply app-server tool call validation',
    path: 'packages/rawengine-schema/samples/computational-merge-super-resolution-apply-app-server-tool-call-validation-v1.json',
    schema: rawEngineAppServerToolCallValidationV1Schema,
    value: sampleComputationalMergeSuperResolutionApplyAppServerToolCallValidationV1,
  },
  {
    name: 'super-resolution dry-run summary',
    path: 'packages/rawengine-schema/samples/super-resolution-dry-run-summary-v1.json',
    schema: superResolutionDryRunSummaryV1Schema,
    value: sampleSuperResolutionDryRunSummaryV1,
  },
  {
    name: 'super-resolution artifact',
    path: 'packages/rawengine-schema/samples/super-resolution-artifact-v1.json',
    schema: superResolutionArtifactV1Schema,
    value: sampleSuperResolutionArtifactV1,
  },
  {
    name: 'preview scope query',
    path: 'packages/rawengine-schema/samples/preview-scope-query-v1.json',
    schema: previewScopeQueryV1Schema,
    value: samplePreviewScopeQueryV1,
  },
  {
    name: 'preview scope result',
    path: 'packages/rawengine-schema/samples/preview-scope-result-v1.json',
    schema: previewScopeResultV1Schema,
    value: samplePreviewScopeResultV1,
  },
  {
    name: 'project library snapshot query',
    path: 'packages/rawengine-schema/samples/project-library-snapshot-query-v1.json',
    schema: projectLibrarySnapshotQueryV1Schema,
    value: sampleProjectLibrarySnapshotQueryV1,
  },
  {
    name: 'project library snapshot',
    path: 'packages/rawengine-schema/samples/project-library-snapshot-v1.json',
    schema: projectLibrarySnapshotV1Schema,
    value: sampleProjectLibrarySnapshotV1,
  },
  {
    name: 'project library command envelope',
    path: 'packages/rawengine-schema/samples/project-library-command-envelope-v1.json',
    schema: projectLibraryCommandEnvelopeV1Schema,
    value: sampleProjectLibraryCommandEnvelopeV1,
  },
  {
    name: 'project library mutation result',
    path: 'packages/rawengine-schema/samples/project-library-mutation-result-v1.json',
    schema: projectLibraryMutationResultV1Schema,
    value: sampleProjectLibraryMutationResultV1,
  },
  {
    name: 'panorama artifact',
    path: 'packages/rawengine-schema/samples/panorama-artifact-v1.json',
    schema: panoramaArtifactV1Schema,
    value: samplePanoramaArtifactV1,
  },
  {
    name: 'panorama backend capability report',
    path: 'packages/rawengine-schema/samples/panorama-backend-capability-report-v1.json',
    schema: panoramaBackendCapabilityReportV1Schema,
    value: samplePanoramaBackendCapabilityReportV1,
  },
  {
    name: 'film look catalog',
    path: 'packages/rawengine-schema/samples/film-look-catalog-v1.json',
    schema: filmLookCatalogV1Schema,
    value: sampleFilmLookCatalogV1,
  },
  {
    name: 'film black and white model',
    path: 'packages/rawengine-schema/samples/film-black-and-white-model-v1.json',
    schema: filmBlackAndWhiteModelV1Schema,
    value: sampleFilmBlackAndWhiteModelV1,
  },
  {
    name: 'film grain model',
    path: 'packages/rawengine-schema/samples/film-grain-model-v1.json',
    schema: filmGrainModelV1Schema,
    value: sampleFilmGrainModelV1,
  },
  {
    name: 'film halation model',
    path: 'packages/rawengine-schema/samples/film-halation-model-v1.json',
    schema: filmHalationModelV1Schema,
    value: sampleFilmHalationModelV1,
  },
  {
    name: 'film glow model',
    path: 'packages/rawengine-schema/samples/film-glow-model-v1.json',
    schema: filmGlowModelV1Schema,
    value: sampleFilmGlowModelV1,
  },
  {
    name: 'negative acquisition profile',
    path: 'packages/rawengine-schema/samples/negative-acquisition-profile-v1.json',
    schema: negativeAcquisitionProfileV1Schema,
    value: sampleNegativeAcquisitionProfileV1,
  },
  {
    name: 'negative roll session',
    path: 'packages/rawengine-schema/samples/negative-roll-session-v1.json',
    schema: negativeRollSessionV1Schema,
    value: sampleNegativeRollSessionV1,
  },
  {
    name: 'negative lab command envelope',
    path: 'packages/rawengine-schema/samples/negative-lab-command-envelope-v1.json',
    schema: negativeLabCommandEnvelopeV1Schema,
    value: sampleNegativeLabCommandEnvelopeV1,
  },
  {
    name: 'negative lab density normalization profile',
    path: 'packages/rawengine-schema/samples/negative-lab-density-normalization-profile-v1.json',
    schema: negativeLabDensityNormalizationProfileV1Schema,
    value: sampleNegativeLabDensityNormalizationProfileV1,
  },
  {
    name: 'negative lab frame detection result',
    path: 'packages/rawengine-schema/samples/negative-lab-frame-detection-result-v1.json',
    schema: negativeLabFrameDetectionResultV1Schema,
    value: sampleNegativeLabFrameDetectionResultV1,
  },
  {
    name: 'negative lab base sample record',
    path: 'packages/rawengine-schema/samples/negative-lab-base-sample-record-v1.json',
    schema: negativeLabBaseSampleRecordV1Schema,
    value: sampleNegativeLabBaseSampleRecordV1,
  },
  {
    name: 'negative lab base fog estimate',
    path: 'packages/rawengine-schema/samples/negative-lab-base-fog-estimate-v1.json',
    schema: negativeLabBaseFogEstimateV1Schema,
    value: sampleNegativeLabBaseFogEstimateV1,
  },
  {
    name: 'negative lab process profile',
    path: 'packages/rawengine-schema/samples/negative-lab-process-profile-v1.json',
    schema: negativeLabProcessProfileV1Schema,
    value: sampleNegativeLabProcessProfileV1,
  },
  {
    name: 'negative lab per-channel inversion curve set',
    path: 'packages/rawengine-schema/samples/negative-lab-per-channel-inversion-curve-set-v1.json',
    schema: negativeLabPerChannelInversionCurveSetV1Schema,
    value: sampleNegativeLabPerChannelInversionCurveSetV1,
  },
  {
    name: 'negative lab QC proof artifact',
    path: 'packages/rawengine-schema/samples/negative-lab-qc-proof-artifact-v1.json',
    schema: negativeLabQcProofArtifactV1Schema,
    value: sampleNegativeLabQcProofArtifactV1,
  },
  {
    name: 'negative lab roll batch workflow',
    path: 'packages/rawengine-schema/samples/negative-lab-roll-batch-workflow-v1.json',
    schema: negativeLabRollBatchWorkflowV1Schema,
    value: sampleNegativeLabRollBatchWorkflowV1,
  },
  {
    name: 'negative lab dry-run result',
    path: 'packages/rawengine-schema/samples/negative-lab-dry-run-result-v1.json',
    schema: negativeLabDryRunResultV1Schema,
    value: sampleNegativeLabDryRunResultV1,
  },
  {
    name: 'negative lab apply plan request',
    path: 'packages/rawengine-schema/samples/negative-lab-apply-plan-request-v1.json',
    schema: negativeLabApplyPlanRequestV1Schema,
    value: sampleNegativeLabApplyPlanRequestV1,
  },
  {
    name: 'negative lab apply result',
    path: 'packages/rawengine-schema/samples/negative-lab-apply-result-v1.json',
    schema: negativeLabApplyResultV1Schema,
    value: sampleNegativeLabApplyResultV1,
  },
  {
    name: 'negative lab conversion operation',
    path: 'packages/rawengine-schema/samples/negative-lab-conversion-operation-v1.json',
    schema: negativeLabConversionOperationV1Schema,
    value: sampleNegativeLabConversionOperationV1,
  },
  {
    name: 'negative lab app-server tool manifest',
    path: 'packages/rawengine-schema/samples/negative-lab-app-server-tool-manifest-v1.json',
    schema: negativeLabAppServerToolManifestV1Schema,
    value: sampleNegativeLabAppServerToolManifestV1,
  },
  {
    name: 'negative lab positive variant provenance',
    path: 'packages/rawengine-schema/samples/negative-lab-positive-variant-provenance-v1.json',
    schema: negativeLabPositiveVariantProvenanceV1Schema,
    value: sampleNegativeLabPositiveVariantProvenanceV1,
  },
  {
    name: 'negative lab built-in preset catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-built-in-preset-catalog-v1.json',
    schema: negativeLabBuiltInPresetCatalogV1Schema,
    value: sampleNegativeLabBuiltInPresetCatalogV1,
  },
  {
    name: 'negative lab preset metadata policy catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-preset-metadata-policy-catalog-v1.json',
    schema: negativeLabPresetMetadataPolicyCatalogV1Schema,
    value: sampleNegativeLabPresetMetadataPolicyCatalogV1,
  },
  {
    name: 'negative lab fixture manifest',
    path: 'packages/rawengine-schema/samples/negative-lab-fixture-manifest-v1.json',
    schema: negativeLabFixtureManifestV1Schema,
    value: sampleNegativeLabFixtureManifestV1,
  },
  {
    name: 'negative lab input profile catalog',
    path: 'packages/rawengine-schema/samples/negative-lab-input-profile-catalog-v1.json',
    schema: negativeLabInputProfileCatalogV1Schema,
    value: sampleNegativeLabInputProfileCatalogV1,
  },
];

const toAbsolutePath = (repoPath: string): string => join(ROOT, repoPath);
const toStableJson = (value: unknown): Promise<string> =>
  format(JSON.stringify(value, null, 2), { parser: 'json', printWidth: 120 });

const updateArtifacts = async (): Promise<void> => {
  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, await toStableJson(artifact.value));
  }

  console.log(`Updated ${sampleArtifacts.length} RawEngine schema sample artifacts.`);
};

const checkArtifacts = async (): Promise<void> => {
  const failures: string[] = [];

  for (const artifact of sampleArtifacts) {
    const absolutePath = toAbsolutePath(artifact.path);
    const expectedContents = await toStableJson(artifact.value);

    if (!existsSync(absolutePath)) {
      failures.push(`${artifact.path}: missing generated sample artifact`);
      continue;
    }

    const actualContents = readFileSync(absolutePath, 'utf8');
    if (actualContents !== expectedContents) {
      failures.push(`${artifact.path}: sample artifact drifted from ${artifact.name}`);
      continue;
    }

    const parsedArtifact = artifact.schema.safeParse(JSON.parse(actualContents));
    if (!parsedArtifact.success) {
      failures.push(`${artifact.path}: checked artifact no longer satisfies ${artifact.name} schema`);
    }
  }

  if (failures.length > 0) {
    console.error('RawEngine schema sample artifact check failed.');
    console.error('Refresh intentional changes with: bun run schema:samples:update');
    console.error(failures.join('\n'));
    process.exit(1);
  }

  console.log(`RawEngine schema sample artifact check passed for ${sampleArtifacts.length} artifacts.`);
};

const args = new Set(process.argv.slice(2));

if (args.has('--update')) {
  await updateArtifacts();
} else {
  await checkArtifacts();
}
