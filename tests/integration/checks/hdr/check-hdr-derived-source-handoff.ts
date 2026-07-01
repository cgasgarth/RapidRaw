#!/usr/bin/env bun

import { openComputationalMergeDerivedSourceV1 } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeDerivedSourceRuntime.ts';
import {
  ApprovalClass,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../../src/schemas/computational-merge/hdrMergeUiSchemas.ts';
import {
  buildHdrDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../../src/utils/derivedOutputReceipt.ts';
import { buildHdrEditableHandoffSummary } from '../../../../src/utils/hdrEditableHandoff.ts';

const sourcePaths = [
  '/proof/hdr/4492/source-under.CR3',
  '/proof/hdr/4492/source-reference.CR3',
  '/proof/hdr/4492/source-over.CR3',
];
const sourceMetadata = sourcePaths.map((path, sourceIndex) => ({
  contentHash: `blake3:hdr-4492-source-${sourceIndex}`,
  graphRevision: `graph_hdr_4492_source_${sourceIndex}`,
  path,
}));

const settings = {
  ...DEFAULT_HDR_MERGE_UI_SETTINGS,
  deghosting: 'medium',
  mergeStrategy: 'scene_linear_radiance',
  toneMapPreview: true,
} as const;

const handoff = buildHdrEditableHandoffSummary({
  deghostReviewAccepted: true,
  deghostReviewRequired: true,
  outputPath: '/proof/hdr/4492/derived/HDR_4492_editable.tiff',
  settings,
  sourceMetadata,
  sourcePaths,
});

const acceptedDryRunPlanHash = 'sha256:hdr-4492-accepted-plan';
const acceptedDryRunPlanId = 'hdr_plan_4492_editable_source';
const receipt = buildHdrDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  handoff,
  settings,
});

if (receipt.openInEditorAction.path === sourcePaths[0]) {
  throw new Error('HDR derived output open action must never target an original bracket source.');
}
if (receipt.sourceContentHashes.join(',') !== sourceMetadata.map((source) => source.contentHash).join(',')) {
  throw new Error('HDR derived output receipt must preserve source file content hashes.');
}
if (receipt.provenanceSidecar?.sourceState[0]?.contentHash !== sourceMetadata[0]?.contentHash) {
  throw new Error('HDR provenance sidecar must carry source content hashes.');
}

const command = {
  actor: { id: 'agent_rawengine', kind: 'agent' },
  approval: {
    approvalClass: ApprovalClass.EditApply,
    reason: 'HDR derived-source handoff applies an accepted review plan.',
    state: 'approved',
  },
  commandId: 'command_hdr_4492_apply',
  commandType: 'computationalMerge.createHdr',
  correlationId: 'corr_hdr_4492_apply',
  dryRun: false,
  expectedGraphRevision: 'graph_hdr_4492_before_apply',
  parameters: {
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId,
    alignmentMode: settings.alignmentMode,
    bracketValidation: settings.bracketValidation,
    deghosting: settings.deghosting,
    maxPreviewDimensionPx: settings.maxPreviewDimensionPx,
    mergeStrategy: settings.mergeStrategy,
    outputName: 'HDR 4492 Editable',
    qualityPreference: settings.qualityPreference,
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      colorSpaceHint: 'camera_rgb',
      exposureEv: [-2, 0, 2][sourceIndex] ?? 0,
      imageId: `img_hdr_4492_${sourceIndex}`,
      imagePath,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex,
    })),
    toneMapPreview: settings.toneMapPreview,
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: { id: 'project_hdr_4492', kind: 'project' },
} as const;

const mutationResult = {
  appliedGraphRevision: 'graph_hdr_4492_after_open',
  changedNodeIds: [receipt.outputArtifactId],
  commandId: command.commandId,
  commandType: command.commandType,
  correlationId: command.correlationId,
  derivedAssetId: receipt.outputArtifactId,
  dryRun: false,
  mutates: true,
  outputArtifacts: [
    {
      artifactId: receipt.outputArtifactId,
      contentHash: receipt.outputContentHash,
      dimensions: { height: 3200, width: 4800 },
      kind: 'merge_output',
      storage: 'export_path',
    },
  ],
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  sourceGraphRevision: command.expectedGraphRevision,
  undoRevision: 'graph_hdr_4492_undo',
  warnings: handoff.warningCodes,
} as const;

const openResult = openComputationalMergeDerivedSourceV1({
  actor: command.actor,
  approval: command.approval,
  command,
  correlationId: 'corr_hdr_4492_open',
  currentGraphRevision: mutationResult.appliedGraphRevision,
  mutationResult,
  receipt: {
    acceptedDryRunPlanHash: receipt.acceptedDryRunPlanHash,
    acceptedDryRunPlanId: receipt.acceptedDryRunPlanId,
    family: receipt.family,
    openInEditorAction: {
      path: receipt.openInEditorAction.path,
      state: receipt.openInEditorAction.state,
    },
    outputArtifactId: receipt.outputArtifactId,
    outputContentHash: receipt.outputContentHash,
    outputPath: receipt.outputPath,
    provenanceSidecarPath: receipt.provenanceSidecar?.sidecarPath,
    receiptId: receipt.receiptId,
    settingsHash: receipt.settingsHash,
    sourceGraphRevisions: receipt.sourceGraphRevisions,
    staleState: receipt.staleState,
  },
  requestId: 'request_hdr_4492_open',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
});

if (openResult.openPath !== receipt.openInEditorAction.path) {
  throw new Error('HDR open-derived-source result must use the receipt output path.');
}

const contentChangedReceipt = buildHdrDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  handoff: buildHdrEditableHandoffSummary({
    deghostReviewAccepted: true,
    deghostReviewRequired: true,
    outputPath: handoff.outputPath,
    settings,
    sourceMetadata: [
      { ...sourceMetadata[0]!, contentHash: 'blake3:hdr-4492-source-0-rewritten' },
      sourceMetadata[1]!,
      sourceMetadata[2]!,
    ],
    sourcePaths,
  }),
  settings,
});
const staleByContent = deriveDerivedOutputReceiptState({ current: contentChangedReceipt, receipt });
if (staleByContent.staleState !== 'stale' || !staleByContent.staleReasons?.includes('source_content_hash_changed')) {
  throw new Error('HDR derived receipt must become stale when a source file content hash changes.');
}

const graphChangedReceipt = buildHdrDerivedOutputReceipt({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  handoff: buildHdrEditableHandoffSummary({
    deghostReviewAccepted: true,
    deghostReviewRequired: true,
    outputPath: handoff.outputPath,
    settings,
    sourceMetadata: [
      sourceMetadata[0]!,
      { ...sourceMetadata[1]!, graphRevision: 'graph_hdr_4492_source_1_retouched' },
      sourceMetadata[2]!,
    ],
    sourcePaths,
  }),
  settings,
});
const staleByGraph = deriveDerivedOutputReceiptState({ current: graphChangedReceipt, receipt });
if (staleByGraph.staleState !== 'stale' || !staleByGraph.staleReasons?.includes('source_graph_revision_changed')) {
  throw new Error('HDR derived receipt must become stale when a source edit graph changes.');
}

expectThrows('stale HDR derived source open', () =>
  openComputationalMergeDerivedSourceV1({
    actor: command.actor,
    approval: command.approval,
    command,
    correlationId: 'corr_hdr_4492_open_stale',
    currentGraphRevision: mutationResult.appliedGraphRevision,
    mutationResult,
    receipt: {
      acceptedDryRunPlanHash: staleByGraph.acceptedDryRunPlanHash,
      acceptedDryRunPlanId: staleByGraph.acceptedDryRunPlanId,
      family: staleByGraph.family,
      openInEditorAction: {
        path: staleByGraph.openInEditorAction.path,
        state: staleByGraph.openInEditorAction.state,
      },
      outputArtifactId: staleByGraph.outputArtifactId,
      outputContentHash: staleByGraph.outputContentHash,
      outputPath: staleByGraph.outputPath,
      provenanceSidecarPath: staleByGraph.provenanceSidecar?.sidecarPath,
      receiptId: staleByGraph.receiptId,
      settingsHash: staleByGraph.settingsHash,
      sourceGraphRevisions: staleByGraph.sourceGraphRevisions,
      staleReasons: staleByGraph.staleReasons,
      staleState: staleByGraph.staleState,
    },
    requestId: 'request_hdr_4492_open_stale',
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  }),
);

console.log(
  JSON.stringify({
    openedDerivedSourceId: openResult.derivedSourceId,
    outputPath: openResult.openPath,
    staleReasons: [...(staleByContent.staleReasons ?? []), ...(staleByGraph.staleReasons ?? [])],
  }),
);

function expectThrows(label: string, callback: () => void) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error(`Expected ${label} to throw.`);
}
