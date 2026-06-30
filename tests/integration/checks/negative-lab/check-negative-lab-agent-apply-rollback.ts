#!/usr/bin/env bun

import {
  sampleNegativeLabApplyPlanRequestV1,
  sampleNegativeLabCommandEnvelopeV1,
} from '../../../../packages/rawengine-schema/src/samplePayloads.ts';
import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  rawEngineAppServerToolDispatchResponseSchema,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { dispatchAgentLiveEditorTool } from '../../../../src/utils/agent/session/agentLiveToolDispatch.ts';
import {
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
  createAgentSessionCheckpoint,
} from '../../../../src/utils/agent/session/agentSessionHistory.ts';
import {
  NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  resetNegativeLabAgentAppServerToolDispatchForTests,
} from '../../../../src/utils/negativeLabAgentAppServerToolDispatch.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/fixtures/negative-lab/synthetic-roll/frame_0001.tif';
const sessionId = sampleNegativeLabCommandEnvelopeV1.parameters.sessionId;
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 3));

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:negative-lab-agent-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '200', LensModel: 'Synthetic Negative Lab Fixture' },
    height: 3000,
    isRaw: false,
    isReady: true,
    originalUrl: 'blob:negative-lab-agent-original',
    path: selectedPath,
    thumbnailUrl: 'blob:negative-lab-agent-thumb',
    width: 4500,
  },
  uncroppedAdjustedPreviewUrl: null,
});

resetNegativeLabAgentAppServerToolDispatchForTests();
const rollbackCheckpoint = createAgentSessionCheckpoint(sessionId);

const dryRunResult = await dispatchAgentLiveEditorTool({
  args: sampleNegativeLabCommandEnvelopeV1,
  requestId: 'negative-lab-agent-dispatch-dry-run',
  runtimeToolName: NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
});
if (!isNegativeLabDryRunResult(dryRunResult)) {
  throw new Error('Negative Lab live dispatch did not return a dry-run runtime receipt.');
}
if (dryRunResult.dryRun.changeSet.updatedFrameIds.join('|') !== 'frame_0001') {
  throw new Error('Negative Lab dry-run dispatch did not preserve selected-frame scope.');
}
if (dryRunResult.dryRun.proof?.selectedCrosstalkProvenance.provenanceHash.length === 0) {
  throw new Error('Negative Lab dry-run dispatch did not expose selected profile provenance.');
}

const acceptedApplyRequest = {
  ...sampleNegativeLabApplyPlanRequestV1,
  acceptedDryRunPlanHash: dryRunResult.acceptedDryRunPlanHash,
  dryRunPlanId: dryRunResult.dryRun.dryRunPlanId,
};
const applyResult = await dispatchAgentLiveEditorTool({
  args: acceptedApplyRequest,
  requestId: 'negative-lab-agent-dispatch-apply',
  runtimeToolName: NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
});
if (!isNegativeLabApplyResult(applyResult)) {
  throw new Error('Negative Lab live dispatch did not return an apply runtime receipt.');
}
if (
  applyResult.apply.dryRunCommandId !== dryRunResult.dryRun.commandId ||
  applyResult.apply.changeSet.updatedFrameIds.join('|') !== 'frame_0001' ||
  applyResult.apply.noOverwritePolicy !== 'never_overwrite_original' ||
  applyResult.apply.proof?.acceptedSuggestionSummary.state !== 'accepted_into_plan' ||
  applyResult.apply.proof.selectedCrosstalkProvenance.provenanceHash !==
    dryRunResult.dryRun.proof?.selectedCrosstalkProvenance.provenanceHash
) {
  throw new Error(
    'Negative Lab accepted apply did not preserve dry-run scope, profile provenance, and receipt policy.',
  );
}

const rejectedTampered = await dispatchForRejection({
  ...acceptedApplyRequest,
  acceptedDryRunPlanHash: 'sha256:tampered_negative_lab_plan',
});
if (!rejectedTampered.message.includes('unaccepted Negative Lab dry-run plan')) {
  throw new Error('Negative Lab tampered apply did not reject with the expected plan-identity reason.');
}

const rejectedStale = await dispatchForRejection({
  ...acceptedApplyRequest,
  expectedSessionRevision: 'graph_rev_negative_stale',
});
if (!rejectedStale.message.includes('stale Negative Lab dry-run session revision')) {
  throw new Error('Negative Lab stale apply did not reject with the expected session-revision reason.');
}

const { approval: _approval, ...missingApprovalApplyRequest } = acceptedApplyRequest;
const rejectedMissingApproval = await dispatchForRejection(missingApprovalApplyRequest);
if (!rejectedMissingApproval.message.includes('approval')) {
  throw new Error('Negative Lab missing-approval apply did not reject at the app-server boundary.');
}

resetNegativeLabAgentAppServerToolDispatchForTests();
const rejectedMissingAcceptedPlan = await dispatchForRejection(acceptedApplyRequest);
if (!rejectedMissingAcceptedPlan.message.includes('unaccepted Negative Lab dry-run plan')) {
  throw new Error('Negative Lab apply without an accepted dry-run did not reject.');
}

useEditorStore.getState().setEditor({
  adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.28 },
  brushSettings: { feather: 50, size: 64, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:negative-lab-agent-after-apply',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.28 }],
  historyIndex: 1,
  selectedImage: useEditorStore.getState().selectedImage,
  uncroppedAdjustedPreviewUrl: null,
});
const rollbackResult = await dispatchAgentLiveEditorTool({
  args: {
    checkpoint: rollbackCheckpoint,
    requestId: 'negative-lab-agent-dispatch-rollback',
    scope: 'operation',
    sessionId,
  },
  requestId: 'negative-lab-agent-dispatch-rollback',
  runtimeToolName: AGENT_HISTORY_ROLLBACK_TOOL_NAME,
});
if (!isRollbackReceipt(rollbackResult)) {
  throw new Error('Negative Lab rollback dispatch did not return a typed rollback receipt.');
}
if (
  rollbackResult.graphRevision !== rollbackCheckpoint.graphRevision ||
  rollbackResult.previewRecipeHash !== rollbackCheckpoint.previewRecipeHash ||
  useEditorStore.getState().historyIndex !== rollbackCheckpoint.historyIndex
) {
  throw new Error('Negative Lab rollback dispatch did not restore the pre-apply checkpoint.');
}

const routes = buildRawEngineAppServerRouteCatalog();
for (const toolName of [
  NEGATIVE_LAB_AGENT_PREVIEW_TOOL_NAME,
  NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
  AGENT_HISTORY_ROLLBACK_TOOL_NAME,
]) {
  if (!routes.some((route) => route.toolNames.includes(toolName))) {
    throw new Error(`Negative Lab agent route catalog is missing ${toolName}.`);
  }
}

console.log('negative lab agent apply rollback ok');

async function dispatchForRejection(args: unknown) {
  const response = rawEngineAppServerToolDispatchResponseSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      requestId: 'negative-lab-agent-dispatch-reject',
      runtimeToolName: NEGATIVE_LAB_AGENT_APPLY_TOOL_NAME,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );
  if (response.dispatchStatus !== 'rejected') {
    throw new Error('Expected Negative Lab app-server dispatch rejection.');
  }
  return response;
}

function isNegativeLabDryRunResult(value: unknown): value is {
  acceptedDryRunPlanHash: string;
  dryRun: {
    changeSet: { updatedFrameIds: string[] };
    commandId: string;
    dryRunPlanId: string;
    proof?: { selectedCrosstalkProvenance: { provenanceHash: string } };
  };
  kind: 'dry_run';
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'dry_run' &&
    'acceptedDryRunPlanHash' in value &&
    'dryRun' in value
  );
}

function isNegativeLabApplyResult(value: unknown): value is {
  apply: {
    changeSet: { updatedFrameIds: string[] };
    dryRunCommandId?: string;
    noOverwritePolicy: 'never_overwrite_original';
    proof?: {
      acceptedSuggestionSummary: { state: 'accepted_into_plan' | 'suggested_only' };
      selectedCrosstalkProvenance: { provenanceHash: string };
    };
  };
  kind: 'apply';
} {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'apply' && 'apply' in value;
}

function isRollbackReceipt(value: unknown): value is {
  graphRevision: string;
  previewRecipeHash: string;
  restoredHistoryIndex: number;
  toolName: typeof AGENT_HISTORY_ROLLBACK_TOOL_NAME;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toolName' in value &&
    value.toolName === AGENT_HISTORY_ROLLBACK_TOOL_NAME
  );
}
