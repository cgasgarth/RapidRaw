#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerHostToolName } from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
} from '../../../src/utils/agentReadOnlyAppServerTools.ts';
import {
  handleRawEngineAppServerHostRequestAsync,
  isApprovedAgentAppServerToolName,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3163.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 2));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
    runtimeToolName: z.string().min(1),
  })
  .passthrough();
const stateResultSchema = z
  .object({
    snapshot: z
      .object({
        graphRevision: z.string().min(1),
        initialPreview: z
          .object({
            recipeHash: z.string().min(1),
            renderHash: z.string().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
const previewResultSchema = z
  .object({
    preview: z
      .object({
        purpose: z.string().min(1),
        recipeHash: z.string().min(1),
        renderHash: z.string().min(1),
      })
      .passthrough(),
  })
  .passthrough();
const applyResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    appliedGraphRevision: z.string().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_ADJUSTMENTS_APPLY_TOOL_NAME),
  })
  .passthrough();
const dryRunResultSchema = z
  .object({
    dryRunPlanHash: z.string().min(1),
    dryRunPlanId: z.string().min(1),
    sourceGraphRevision: z.string().min(1),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME),
  })
  .passthrough();

const dispatch = async (runtimeToolName: string, args: unknown, requestId: string) =>
  dispatchResponseSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );

const dispatchWithDraftSession = async (
  runtimeToolName: string,
  args: unknown,
  requestId: string,
  draftSession: {
    draftRevision: number;
    parentRecipeHash: string;
    selectedImagePath: string;
    sessionId: string;
    status: 'active' | 'cancelled';
  },
) =>
  dispatchResponseSchema.parse(
    await handleRawEngineAppServerHostRequestAsync({
      arguments: args,
      draftSession,
      requestId,
      runtimeToolName,
      toolName: RawEngineAppServerHostToolName.DispatchTool,
    }),
  );

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-dispatch-before',
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
    exif: { ISO: '320', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3163',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3163',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const state = await dispatch(AGENT_STATE_GET_TOOL_NAME, { requestId: 'agent-dispatch-state-1' }, 'dispatch-state-1');
if (state.dispatchStatus !== 'completed') throw new Error('agent.state.get dispatch did not complete.');
const initialState = stateResultSchema.parse(state.result);
const initialRecipeHash = initialState.snapshot.initialPreview.recipeHash;
const initialRenderHash = initialState.snapshot.initialPreview.renderHash;

const initialPreview = await dispatch(
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  { expectedRecipeHash: initialRecipeHash, purpose: 'initial_context', requestId: 'agent-dispatch-preview-1' },
  'dispatch-preview-1',
);
if (initialPreview.dispatchStatus !== 'completed') throw new Error('agent.preview.render dispatch did not complete.');
if (previewResultSchema.parse(initialPreview.result).preview.purpose !== 'initial_context') {
  throw new Error('agent.preview.render dispatch did not preserve preview purpose.');
}

const dryRun = await dispatch(
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  {
    adjustments: { exposure: 0.32, shadows: 18 },
    expectedGraphRevision: initialState.snapshot.graphRevision,
    expectedRecipeHash: initialRecipeHash,
    operationId: 'agent_dispatch_apply_3163',
    requestId: 'agent-dispatch-dry-run-1',
    sessionId: 'agent-dispatch-3163',
  },
  'dispatch-dry-run-1',
);
const dryRunPayload = dryRunResultSchema.parse(dryRun.result);
if (
  dryRun.dispatchStatus !== 'completed' ||
  dryRunPayload.sourceGraphRevision !== initialState.snapshot.graphRevision
) {
  throw new Error('agent.adjustments.dry_run dispatch did not produce a bound receipt.');
}

const apply = await dispatch(
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  {
    acceptedPlanHash: dryRunPayload.dryRunPlanHash,
    acceptedPlanId: dryRunPayload.dryRunPlanId,
    adjustments: { exposure: 0.32, shadows: 18 },
    expectedGraphRevision: dryRunPayload.sourceGraphRevision,
    expectedRecipeHash: initialRecipeHash,
    operationId: 'agent_dispatch_apply_3163',
    requestId: 'agent-dispatch-apply-1',
    sessionId: 'agent-dispatch-3163',
  },
  'dispatch-apply-1',
);
const applyPayload = applyResultSchema.parse(apply.result);
if (apply.dispatchStatus !== 'completed' || applyPayload.appliedGraphRevision !== 'history_1') {
  throw new Error('agent.adjustments.apply dispatch did not mutate the editor session.');
}

const refreshedState = await dispatch(
  AGENT_STATE_GET_TOOL_NAME,
  { requestId: 'agent-dispatch-state-2' },
  'dispatch-state-2',
);
const refreshedStatePayload = stateResultSchema.parse(refreshedState.result);
if (refreshedStatePayload.snapshot.initialPreview.recipeHash === initialRecipeHash) {
  throw new Error('agent dispatch did not update recipe hash after apply.');
}

const draftSession = {
  draftRevision: 1,
  parentRecipeHash: refreshedStatePayload.snapshot.initialPreview.recipeHash,
  selectedImagePath: selectedPath,
  sessionId: 'agent-dispatch-3163',
  status: 'active' as const,
};
const draftDryRun = await dispatchWithDraftSession(
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  {
    adjustments: { contrast: 9 },
    expectedGraphRevision: refreshedStatePayload.snapshot.graphRevision,
    expectedRecipeHash: draftSession.parentRecipeHash,
    operationId: 'agent_dispatch_draft_apply_3163',
    requestId: 'agent-dispatch-draft-dry-run-1',
    sessionId: draftSession.sessionId,
  },
  'dispatch-draft-dry-run-1',
  draftSession,
);
const draftDryRunPayload = dryRunResultSchema.parse(draftDryRun.result);
if (draftDryRun.dispatchStatus !== 'completed') {
  throw new Error('agent draft session did not allow current active typed dry-run.');
}
const draftApply = await dispatchWithDraftSession(
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  {
    acceptedPlanHash: draftDryRunPayload.dryRunPlanHash,
    acceptedPlanId: draftDryRunPayload.dryRunPlanId,
    adjustments: { contrast: 9 },
    expectedGraphRevision: draftDryRunPayload.sourceGraphRevision,
    expectedRecipeHash: draftSession.parentRecipeHash,
    operationId: 'agent_dispatch_draft_apply_3163',
    requestId: 'agent-dispatch-draft-apply-1',
    sessionId: draftSession.sessionId,
  },
  'dispatch-draft-apply-1',
  draftSession,
);
if (draftApply.dispatchStatus !== 'completed') {
  throw new Error('agent draft session did not allow current active typed mutation.');
}
const postDraftState = await dispatch(
  AGENT_STATE_GET_TOOL_NAME,
  { requestId: 'agent-dispatch-state-3' },
  'dispatch-state-3',
);
const postDraftStatePayload = stateResultSchema.parse(postDraftState.result);
const draftRejectCases = [
  {
    expectedMessage: 'cancelled',
    session: {
      ...draftSession,
      parentRecipeHash: postDraftStatePayload.snapshot.initialPreview.recipeHash,
      status: 'cancelled' as const,
    },
  },
  {
    expectedMessage: 'parent recipe hash is stale',
    session: {
      ...draftSession,
      draftRevision: 2,
      parentRecipeHash: refreshedStatePayload.snapshot.initialPreview.recipeHash,
    },
  },
  {
    expectedMessage: 'selected image does not match',
    session: {
      ...draftSession,
      draftRevision: 2,
      parentRecipeHash: postDraftStatePayload.snapshot.initialPreview.recipeHash,
      selectedImagePath: '/tmp/other.ARW',
    },
  },
  {
    expectedMessage: 'revision does not match',
    session: {
      ...draftSession,
      draftRevision: 1,
      parentRecipeHash: postDraftStatePayload.snapshot.initialPreview.recipeHash,
    },
  },
];
for (const { expectedMessage, session } of draftRejectCases) {
  const rejected = await dispatchWithDraftSession(
    AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    {
      acceptedPlanHash: draftDryRunPayload.dryRunPlanHash,
      acceptedPlanId: draftDryRunPayload.dryRunPlanId,
      adjustments: { contrast: 12 },
      expectedGraphRevision: postDraftStatePayload.snapshot.graphRevision,
      expectedRecipeHash: postDraftStatePayload.snapshot.initialPreview.recipeHash,
      operationId: `agent_dispatch_reject_${expectedMessage}`,
      requestId: `agent-dispatch-reject-${expectedMessage}`,
      sessionId: draftSession.sessionId,
    },
    `dispatch-reject-${expectedMessage}`,
    session,
  );
  if (rejected.dispatchStatus !== 'rejected' || !rejected.message?.includes(expectedMessage)) {
    throw new Error(`agent draft session did not reject ${expectedMessage}.`);
  }
}

const refreshedPreview = await dispatch(
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  {
    expectedRecipeHash: postDraftStatePayload.snapshot.initialPreview.recipeHash,
    longEdgePx: 1024,
    purpose: 'refresh',
    requestId: 'agent-dispatch-preview-2',
  },
  'dispatch-preview-2',
);
const refreshedPreviewPayload = previewResultSchema.parse(refreshedPreview.result);
if (
  refreshedPreview.dispatchStatus !== 'completed' ||
  refreshedPreviewPayload.preview.renderHash === initialRenderHash ||
  refreshedPreviewPayload.preview.purpose !== 'refresh'
) {
  throw new Error('agent dispatch did not return a fresh post-edit preview.');
}

const staleApply = await dispatch(
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  {
    acceptedPlanHash: dryRunPayload.dryRunPlanHash,
    acceptedPlanId: dryRunPayload.dryRunPlanId,
    adjustments: { exposure: 0.5 },
    expectedGraphRevision: dryRunPayload.sourceGraphRevision,
    expectedRecipeHash: initialRecipeHash,
    operationId: 'agent_dispatch_stale_3163',
    requestId: 'agent-dispatch-stale-1',
    sessionId: 'agent-dispatch-3163',
  },
  'dispatch-stale-1',
);
if (staleApply.dispatchStatus !== 'rejected' || !staleApply.message?.includes('stale recipe hash')) {
  throw new Error('agent dispatch did not reject stale mutating tool calls.');
}

const disallowedAgentTools = [
  'patchRecipe',
  'setRawAdjustment',
  'clickUi',
  'runEditorCommand',
  'ai.mask.apply_subject',
] as const;
for (const runtimeToolName of disallowedAgentTools) {
  if (isApprovedAgentAppServerToolName(runtimeToolName)) {
    throw new Error(`${runtimeToolName} was incorrectly approved as an agent app-server tool.`);
  }
  const rejected = await dispatch(
    runtimeToolName,
    {
      commandType: runtimeToolName,
      dryRun: false,
      operationId: `blocked_${runtimeToolName}`,
      sessionId: 'agent-dispatch-3163',
    },
    `blocked-${runtimeToolName}`,
  );
  if (
    rejected.dispatchStatus !== 'rejected' ||
    !rejected.message?.includes('not an approved typed agent app-server tool')
  ) {
    throw new Error(`${runtimeToolName} did not reject as an untyped agent-session mutation.`);
  }
}

console.log('agent app-server dispatch ok (typed tools + blocked generic agent mutations)');
