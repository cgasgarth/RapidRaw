import { expect, test } from 'bun:test';
import type { HdrAppServerRuntimeToolResultV1 } from '../../../packages/rawengine-schema/src/hdr/hdrAppServerRuntime';
import {
  createRawEngineLocalAppServerBridge,
  dispatchRawEngineLocalAppServerComputationalMergeDerivedSourceOpen,
} from '../../../packages/rawengine-schema/src/localAppServerBridge';
import {
  ApprovalClass,
  type ComputationalMergeCommandEnvelopeV1,
  type ComputationalMergeDerivedSourceOpenRequestV1,
  computationalMergeDerivedSourceOpenResultV1Schema,
  computationalMergeDryRunResultV1Schema,
  computationalMergeMutationResultV1Schema,
  type EditGraphCommandEnvelopeV1,
  editGraphDryRunResultV1Schema,
  editGraphMutationResultV1Schema,
  RAW_ENGINE_SCHEMA_VERSION,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas';
import { buildDerivedOutputProvenanceSidecar } from '../../../src/utils/derivedOutputReceipt';
import { buildHdrReopenedDerivedOutputReceipt } from '../../../src/utils/hdrDerivedSourceReopen';

const actor = { id: 'agent_issue_4820', kind: 'agent' } as const;
const hdrOutputPath = '/fixtures/hdr/reopened/Window_Light_HDR.tif';
const hdrSettingsHash = 'sha256:hdr-reopen-edit-settings';
const sourcePaths = [
  '/fixtures/hdr/reopened/window_light_-2ev.CR3',
  '/fixtures/hdr/reopened/window_light_0ev.CR3',
  '/fixtures/hdr/reopened/window_light_+2ev.CR3',
];

const buildHdrCommand = ({
  acceptedDryRunPlanHash,
  acceptedDryRunPlanId,
  commandId,
  dryRun,
  expectedGraphRevision,
}: {
  acceptedDryRunPlanHash?: string;
  acceptedDryRunPlanId?: string;
  commandId: string;
  dryRun: boolean;
  expectedGraphRevision: string;
}): ComputationalMergeCommandEnvelopeV1 => ({
  actor,
  approval: {
    approvalClass: dryRun ? ApprovalClass.PreviewOnly : ApprovalClass.EditApply,
    reason: dryRun ? 'Preview HDR reopen edit fixture.' : 'Apply approved HDR merge for reopen edit fixture.',
    state: dryRun ? 'not_required' : 'approved',
  },
  commandId,
  commandType: 'computationalMerge.createHdr',
  correlationId: `corr_${commandId}`,
  dryRun,
  expectedGraphRevision,
  parameters: {
    ...(acceptedDryRunPlanHash === undefined ? {} : { acceptedDryRunPlanHash }),
    ...(acceptedDryRunPlanId === undefined ? {} : { acceptedDryRunPlanId }),
    alignmentMode: 'translation',
    bracketValidation: 'required',
    deghostConfidenceMapVisible: true,
    deghostRegionIntensityPercent: 70,
    deghosting: 'medium',
    maxPreviewDimensionPx: 2048,
    mergeStrategy: 'scene_linear_radiance',
    outputName: 'Window Light HDR',
    qualityPreference: 'balanced',
    sources: sourcePaths.map((imagePath, sourceIndex) => ({
      colorSpaceHint: 'camera_linear_rgb',
      exposureEv: (sourceIndex - 1) * 2,
      imageId: `img_hdr_reopen_${sourceIndex}`,
      imagePath,
      rawDefaultsApplied: true,
      role: 'hdr_bracket',
      sourceIndex,
    })),
    toneMapPreview: true,
    toneMappingPreset: 'natural',
  },
  schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  target: {
    id: 'project_hdr_reopen_edit',
    kind: 'project',
  },
});

const getDispatchResult = async <TResult>(
  bridge: ReturnType<typeof createRawEngineLocalAppServerBridge>,
  command: unknown,
): Promise<TResult> => {
  const result = await bridge.dispatch<TResult>(command);
  if (!result.ok) throw new Error(result.message);
  return result.result;
};

test('app-server reopens runtime HDR artifact and accepts a normal edit graph patch', async () => {
  const bridge = createRawEngineLocalAppServerBridge();
  const dryRunCommand = buildHdrCommand({
    commandId: 'hdr_reopen_edit_preview',
    dryRun: true,
    expectedGraphRevision: 'graph_hdr_reopen_edit_base',
  });

  const dryRunToolResult = await getDispatchResult<HdrAppServerRuntimeToolResultV1>(bridge, dryRunCommand);
  const dryRunResult = computationalMergeDryRunResultV1Schema.parse(
    dryRunToolResult.kind === 'dry_run' ? dryRunToolResult.dryRun.dryRunResult : undefined,
  );
  const acceptedDryRunPlanHash =
    dryRunToolResult.kind === 'dry_run' ? dryRunToolResult.acceptedDryRunPlanHash : undefined;
  if (acceptedDryRunPlanHash === undefined) throw new Error('HDR dry-run did not return an accepted plan hash.');

  const applyCommand = buildHdrCommand({
    acceptedDryRunPlanHash,
    acceptedDryRunPlanId: dryRunResult.mergePlan.planId,
    commandId: 'hdr_reopen_edit_apply',
    dryRun: false,
    expectedGraphRevision: dryRunResult.sourceGraphRevision,
  });
  const applyToolResult = await getDispatchResult<HdrAppServerRuntimeToolResultV1>(bridge, applyCommand);
  const applyPayload = applyToolResult.kind === 'apply' ? applyToolResult.apply : undefined;
  if (applyPayload === undefined) throw new Error('HDR apply did not return an apply payload.');
  const mutationResult = computationalMergeMutationResultV1Schema.parse(applyPayload?.mutationResult);
  const [outputArtifact] = mutationResult.outputArtifacts;
  if (outputArtifact === undefined) throw new Error('HDR apply did not return an output artifact.');

  const sidecarArtifact = applyPayload?.sidecarArtifact;
  if (sidecarArtifact === undefined) throw new Error('HDR apply did not return a sidecar artifact.');

  const sidecar = buildDerivedOutputProvenanceSidecar({
    acceptedApplyId: mutationResult.derivedAssetId,
    acceptedDryRunId: dryRunResult.mergePlan.planId,
    family: 'hdr',
    hdr: {
      deghostMaskArtifactCount: sidecarArtifact.deghosting.masks.length,
      deghostMaskArtifacts: sidecarArtifact.deghosting.masks,
      motionCoverageRatio: sidecarArtifact.deghosting.motionCoverageRatio,
      requestedDeghosting: sidecarArtifact.deghosting.requestedDeghosting,
    },
    outputContentHash: outputArtifact.contentHash,
    outputPath: hdrOutputPath,
    receiptId: 'receipt_hdr_reopen_edit',
    settingsHash: hdrSettingsHash,
    sourceContentHashes: applyPayload.provenance.sourceState.map((source) => source.contentHash),
    sourceGraphRevisions: applyPayload.provenance.sourceState.map((source) => source.graphRevision),
    sourcePaths,
    warnings: sidecarArtifact.warningCodes,
  });
  const reopenedReceipt = buildHdrReopenedDerivedOutputReceipt({
    imagePath: hdrOutputPath,
    metadata: {
      rawEngineArtifacts: {
        derivedOutputProvenanceSidecars: [sidecar],
        hdrMergeArtifacts: [sidecarArtifact],
        schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
      },
    },
  });
  if (reopenedReceipt === null) throw new Error('HDR reopen utility did not rebuild a derived output receipt.');
  expect(reopenedReceipt.openInEditorAction.path).toBe(hdrOutputPath);
  expect(reopenedReceipt.staleState).toBe('current');

  const openRequest: ComputationalMergeDerivedSourceOpenRequestV1 = {
    actor,
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Open approved HDR derived artifact for normal editing.',
      state: 'approved',
    },
    command: applyCommand,
    correlationId: 'corr_hdr_reopen_edit_open',
    currentGraphRevision: mutationResult.appliedGraphRevision,
    mutationResult,
    receipt: {
      acceptedDryRunPlanHash,
      acceptedDryRunPlanId: dryRunResult.mergePlan.planId,
      family: 'hdr',
      openInEditorAction: {
        path: reopenedReceipt.openInEditorAction.path,
        state: reopenedReceipt.openInEditorAction.state,
      },
      outputArtifactId: reopenedReceipt.outputArtifactId,
      outputContentHash: reopenedReceipt.outputContentHash,
      outputPath: reopenedReceipt.outputPath,
      provenanceSidecarPath: reopenedReceipt.provenanceSidecar?.sidecarPath,
      receiptId: reopenedReceipt.receiptId,
      settingsHash: reopenedReceipt.settingsHash,
      sourceGraphRevisions: reopenedReceipt.sourceGraphRevisions,
      staleState: reopenedReceipt.staleState,
    },
    requestId: 'request_hdr_reopen_edit_open',
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
  };
  const openResult = computationalMergeDerivedSourceOpenResultV1Schema.parse(
    dispatchRawEngineLocalAppServerComputationalMergeDerivedSourceOpen(openRequest),
  );
  expect(openResult.family).toBe('hdr');
  expect(openResult.openPath).toBe(hdrOutputPath);
  expect(openResult.appliedGraphRevision).toBe(mutationResult.appliedGraphRevision);

  const editDryRunCommand: EditGraphCommandEnvelopeV1 = {
    actor,
    approval: {
      approvalClass: ApprovalClass.PreviewOnly,
      reason: 'Preview normal edit on reopened HDR artifact.',
      state: 'not_required',
    },
    commandId: 'edit_reopened_hdr_basic_tone_preview',
    commandType: 'editGraph.applyParameterPatch',
    correlationId: 'corr_edit_reopened_hdr_basic_tone_preview',
    dryRun: true,
    expectedGraphRevision: openResult.appliedGraphRevision,
    parameters: {
      label: 'Adjust exposure on reopened HDR',
      operations: [
        {
          nodeId: 'legacy_adjustments',
          op: 'replace',
          path: '/tone/exposure',
          previousValue: 0,
          value: 0.35,
        },
      ],
    },
    schemaVersion: RAW_ENGINE_SCHEMA_VERSION,
    target: {
      imagePath: openResult.openPath,
      kind: 'image',
    },
  };
  const editDryRun = editGraphDryRunResultV1Schema.parse(await getDispatchResult(bridge, editDryRunCommand));
  expect(editDryRun.sourceGraphRevision).toBe(openResult.appliedGraphRevision);

  const editApplyCommand: EditGraphCommandEnvelopeV1 = {
    ...editDryRunCommand,
    approval: {
      approvalClass: ApprovalClass.EditApply,
      reason: 'Apply normal edit on reopened HDR artifact.',
      state: 'approved',
    },
    commandId: 'edit_reopened_hdr_basic_tone_apply',
    correlationId: 'corr_edit_reopened_hdr_basic_tone_apply',
    dryRun: false,
  };
  const editApply = editGraphMutationResultV1Schema.parse(await getDispatchResult(bridge, editApplyCommand));

  expect(editApply.appliedGraphRevision).toBe(
    `${openResult.appliedGraphRevision}:edit_graph:${editApplyCommand.commandId}`,
  );
  expect(editApply.changedNodeIds).toEqual(['legacy_adjustments']);
  expect(editApply.sourceGraphRevision).toBe(openResult.appliedGraphRevision);
});
