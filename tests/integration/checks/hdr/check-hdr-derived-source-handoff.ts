#!/usr/bin/env bun

import { openComputationalMergeDerivedSourceV1 } from '../../../../packages/rawengine-schema/src/computational-merge/computationalMergeDerivedSourceRuntime.ts';
import {
  ApprovalClass,
  hdrRuntimeSidecarReceiptV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { DEFAULT_HDR_MERGE_UI_SETTINGS } from '../../../../src/schemas/computational-merge/hdrMergeUiSchemas.ts';
import {
  buildHdrDerivedOutputReceipt,
  deriveDerivedOutputReceiptState,
} from '../../../../src/utils/derivedOutputReceipt.ts';
import {
  buildHdrReopenedDerivedOutputReceipt,
  upsertHdrReopenedDerivedOutputReceipt,
} from '../../../../src/utils/hdrDerivedSourceReopen.ts';
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

const runtimeSidecarReceipt = hdrRuntimeSidecarReceiptV1Schema.parse({
  alignment: {
    confidence: 0.997,
    maxRmsError: 0.2,
    mode: 'translation',
    transformCount: 3,
  },
  bracket: {
    accepted: true,
    detectionConfidence: 0.99,
    exposureSpreadEv: 4,
    referenceSourceIndex: 1,
    sourceCount: 3,
    sourceRoles: [
      { exposureEv: -2, role: 'under_exposed', sourceIndex: 0 },
      { exposureEv: 0, role: 'reference', sourceIndex: 1 },
      { exposureEv: 2, role: 'over_exposed', sourceIndex: 2 },
    ],
  },
  deghost: {
    averageConfidence: 0.94,
    maxConfidence: 1,
    motionCoverageRatio: 0.018,
    motionPixelCount: 27648,
    regionIntensityPercent: 65,
    requestedDeghosting: 'medium',
  },
  handoff: {
    editableDerivedAssetId: 'derived_command_hdr_4492_apply',
    openInEditorPath: '/proof/hdr/4492/derived/HDR_4492_editable.tiff',
    route: 'computational_merge_derived_source',
  },
  measurementSource: 'hdr_runtime_apply',
  output: {
    artifactId: 'artifact_hdr_4492_apply_output',
    contentHash: 'sha256:hdr-4492-runtime-output',
    dimensions: { height: 3200, width: 4800 },
  },
  receiptKind: 'hdr_runtime_sidecar_receipt',
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
});

const handoff = buildHdrEditableHandoffSummary({
  deghostReviewAccepted: true,
  deghostReviewRequired: true,
  outputPath: '/proof/hdr/4492/derived/HDR_4492_editable.tiff',
  runtimeSidecarReceipt,
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
if (receipt.outputArtifactId !== runtimeSidecarReceipt.handoff.editableDerivedAssetId) {
  throw new Error('HDR derived output receipt must use the measured runtime editable derived asset id.');
}
if (receipt.outputContentHash !== runtimeSidecarReceipt.output.contentHash) {
  throw new Error('HDR derived output receipt must preserve the measured runtime output hash.');
}
if (handoff.runtimeSidecarReceipt?.deghost.motionPixelCount !== runtimeSidecarReceipt.deghost.motionPixelCount) {
  throw new Error('HDR editable handoff must preserve measured deghost sidecar metrics.');
}
if (!handoff.warningCodes.includes('motion_detected')) {
  throw new Error('HDR editable handoff must preserve runtime motion warnings.');
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
      artifactId: runtimeSidecarReceipt.output.artifactId,
      contentHash: receipt.outputContentHash,
      dimensions: runtimeSidecarReceipt.output.dimensions,
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

const provenanceSidecar = receipt.provenanceSidecar;
if (provenanceSidecar === undefined) {
  throw new Error('HDR derived receipt must include a provenance sidecar before reopen validation.');
}

const reopenedSidecarMetadata = {
  rawEngineArtifacts: {
    derivedOutputProvenanceSidecars: [provenanceSidecar],
    hdrMergeArtifacts: [
      {
        dryRun: {
          acceptedDryRunPlanHash,
          acceptedDryRunPlanId,
        },
        editableDerivedAssetId: receipt.outputArtifactId,
        family: 'hdr',
        outputArtifact: {
          artifactId: runtimeSidecarReceipt.output.artifactId,
          contentHash: receipt.outputContentHash,
        },
        staleState: {
          state: 'current',
        },
      },
    ],
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  },
};
const reopenedReceipt = buildHdrReopenedDerivedOutputReceipt({
  imagePath: handoff.outputPath,
  metadata: reopenedSidecarMetadata,
});
if (reopenedReceipt === null) {
  throw new Error('Reopened HDR output metadata must produce an editable derived-source receipt.');
}
if (reopenedReceipt.openInEditorAction.path !== handoff.outputPath) {
  throw new Error('Reopened HDR output receipt must open the saved merge output, not a source bracket.');
}
if (reopenedReceipt.provenanceSidecar?.sourceState[1]?.path !== sourcePaths[1]) {
  throw new Error('Reopened HDR output receipt must preserve source provenance paths from the runtime sidecar.');
}
if (reopenedReceipt.outputContentHash !== receipt.outputContentHash) {
  throw new Error('Reopened HDR output receipt must preserve the saved output content hash.');
}
if (reopenedReceipt.acceptedDryRunPlanHash !== acceptedDryRunPlanHash) {
  throw new Error('Reopened HDR output receipt must preserve the accepted runtime dry-run plan hash.');
}
const reopenedReceipts = new Map<string, typeof reopenedReceipt>();
const upsertedReceipt = upsertHdrReopenedDerivedOutputReceipt({
  imagePath: handoff.outputPath,
  metadata: reopenedSidecarMetadata,
  upsert: (nextReceipt) => reopenedReceipts.set(nextReceipt.receiptId, nextReceipt),
});
if (upsertedReceipt === null || reopenedReceipts.get(reopenedReceipt.receiptId)?.staleState !== 'current') {
  throw new Error('Selecting a reopened HDR output must upsert the editable receipt into runtime UI state.');
}
if (
  buildHdrReopenedDerivedOutputReceipt({
    imagePath: sourcePaths[0]!,
    metadata: reopenedSidecarMetadata,
  }) !== null
) {
  throw new Error('HDR sidecar reopen must not attach the derived receipt to an original bracket source.');
}

console.log(
  JSON.stringify({
    openedDerivedSourceId: openResult.derivedSourceId,
    outputPath: openResult.openPath,
    reopenedReceiptId: reopenedReceipt.receiptId,
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
