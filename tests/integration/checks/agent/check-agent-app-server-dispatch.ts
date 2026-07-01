#!/usr/bin/env bun

import { z } from 'zod';

import {
  toneColorDryRunResultV1Schema,
  toneColorMutationResultV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerHostToolName } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
} from '../../../../src/utils/agent/context/agentReadOnlyAppServerTools.ts';
import {
  buildBasicToneCommandEnvelope,
  buildBasicToneImageCommandContext,
  type LegacyBasicToneAdjustmentPayload,
} from '../../../../src/utils/basicToneCommandBridge.ts';
import {
  handleRawEngineAppServerHostRequestAsync,
  isApprovedAgentAppServerToolName,
} from '../../../../src/utils/rawEngineAppServerHost.ts';
import { ToneColorAppServerToolName } from '../../../../src/utils/toneColorAppServerRouteIds.ts';

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
    appliedGraphRevision: z.string().min(1),
    commandType: z.literal('toneColor.setBasicTone'),
    mutates: z.literal(true),
  })
  .passthrough();
const dryRunResultSchema = z
  .object({
    commandType: z.literal('toneColor.setBasicTone'),
    dryRunPlanHash: z.string().min(1),
    dryRunPlanId: z.string().min(1),
    mutates: z.literal(false),
    sourceGraphRevision: z.string().min(1),
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

const buildBasicTonePayload = (patch: Partial<LegacyBasicToneAdjustmentPayload>): LegacyBasicToneAdjustmentPayload => {
  const base = useEditorStore.getState().adjustments;
  return {
    blacks: patch.blacks ?? base.blacks,
    brightness: patch.brightness ?? base.brightness,
    clarity: patch.clarity ?? base.clarity,
    contrast: patch.contrast ?? base.contrast,
    exposure: patch.exposure ?? base.exposure,
    highlights: patch.highlights ?? base.highlights,
    saturation: patch.saturation ?? base.saturation,
    shadows: patch.shadows ?? base.shadows,
    whites: patch.whites ?? base.whites,
  };
};

const buildTypedBasicToneCommand = ({
  acceptedPlanHash,
  acceptedPlanId,
  dryRun,
  expectedGraphRevision,
  operationId,
  patch,
  sessionId,
}: {
  acceptedPlanHash?: string;
  acceptedPlanId?: string;
  dryRun: boolean;
  expectedGraphRevision: string;
  operationId: string;
  patch: Partial<LegacyBasicToneAdjustmentPayload>;
  sessionId: string;
}) =>
  buildBasicToneCommandEnvelope(
    buildBasicTonePayload(patch),
    buildBasicToneImageCommandContext({
      expectedGraphRevision,
      imagePath: selectedPath,
      operationId,
      sessionId,
    }),
    {
      ...(acceptedPlanHash === undefined ? {} : { acceptedDryRunPlanHash: acceptedPlanHash }),
      ...(acceptedPlanId === undefined ? {} : { acceptedDryRunPlanId: acceptedPlanId }),
      dryRun,
    },
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

const imagePreview = await dispatch(
  RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  { expectedRecipeHash: initialRecipeHash, requestId: 'agent-dispatch-image-preview-1' },
  'dispatch-image-preview-1',
);
if (imagePreview.dispatchStatus !== 'completed') {
  throw new Error('rawengine.image.get_preview dispatch did not complete.');
}
const imagePreviewResult = z
  .object({
    dimensions: z
      .object({
        height: z.number().int().positive(),
        longEdgePx: z.literal(1536),
        width: z.number().int().positive(),
      })
      .passthrough(),
    editRevision: z.object({ graphRevision: z.string().min(1), recipeHash: z.string().min(1) }).passthrough(),
    preview: z.object({ includesOriginalRaw: z.literal(false), purpose: z.literal('initial_context') }).passthrough(),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME),
  })
  .passthrough()
  .parse(imagePreview.result);
if (
  imagePreviewResult.staleRecipeHash ||
  imagePreviewResult.editRevision.graphRevision !== initialState.snapshot.graphRevision ||
  imagePreviewResult.editRevision.recipeHash !== initialRecipeHash ||
  imagePreviewResult.dimensions.width <= 0 ||
  imagePreviewResult.dimensions.height <= 0
) {
  throw new Error('rawengine.image.get_preview dispatch did not return current bounded preview metadata.');
}

const dryRun = await dispatch(
  ToneColorAppServerToolName.DryRunCommand,
  buildTypedBasicToneCommand({
    dryRun: true,
    expectedGraphRevision: initialState.snapshot.graphRevision,
    operationId: 'agent_dispatch_apply_3163',
    patch: { exposure: 0.32, shadows: 18 },
    sessionId: 'agent-dispatch-3163',
  }),
  'dispatch-dry-run-1',
);
if (dryRun.dispatchStatus !== 'completed') {
  throw new Error(`typed tonecolor.dry_run_command dispatch rejected: ${dryRun.message ?? 'missing message'}`);
}
const dryRunPayload = dryRunResultSchema.parse(toneColorDryRunResultV1Schema.parse(dryRun.result));
if (dryRunPayload.sourceGraphRevision !== initialState.snapshot.graphRevision) {
  throw new Error('typed tonecolor.dry_run_command dispatch did not produce a bound receipt.');
}

const invalidTypedDryRun = await dispatch(
  ToneColorAppServerToolName.DryRunCommand,
  {
    ...buildTypedBasicToneCommand({
      dryRun: true,
      expectedGraphRevision: initialState.snapshot.graphRevision,
      operationId: 'agent_dispatch_invalid_3163',
      patch: { exposure: 0.2 },
      sessionId: 'agent-dispatch-3163',
    }),
    dryRun: false,
  },
  'dispatch-invalid-typed-dry-run-1',
);
if (invalidTypedDryRun.dispatchStatus !== 'rejected' || !invalidTypedDryRun.message?.includes('validation rejected')) {
  throw new Error('typed tonecolor.dry_run_command accepted an invalid dryRun=false payload.');
}

const apply = await dispatch(
  ToneColorAppServerToolName.ApplyCommand,
  buildTypedBasicToneCommand({
    acceptedPlanHash: dryRunPayload.dryRunPlanHash,
    acceptedPlanId: dryRunPayload.dryRunPlanId,
    dryRun: false,
    expectedGraphRevision: dryRunPayload.sourceGraphRevision,
    operationId: 'agent_dispatch_apply_3163',
    patch: { exposure: 0.32, shadows: 18 },
    sessionId: 'agent-dispatch-3163',
  }),
  'dispatch-apply-1',
);
if (apply.dispatchStatus !== 'completed') {
  throw new Error(`typed tonecolor.apply_command dispatch rejected: ${apply.message ?? 'missing message'}`);
}
const applyPayload = applyResultSchema.parse(toneColorMutationResultV1Schema.parse(apply.result));
if (
  applyPayload.appliedGraphRevision.length === 0 ||
  useEditorStore.getState().historyIndex !== 1 ||
  useEditorStore.getState().adjustments.exposure !== 0.32
) {
  throw new Error('typed tonecolor.apply_command dispatch did not mutate the editor session.');
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
  ToneColorAppServerToolName.DryRunCommand,
  buildTypedBasicToneCommand({
    dryRun: true,
    expectedGraphRevision: refreshedStatePayload.snapshot.graphRevision,
    operationId: 'agent_dispatch_draft_apply_3163',
    patch: { contrast: 9 },
    sessionId: draftSession.sessionId,
  }),
  'dispatch-draft-dry-run-1',
  draftSession,
);
const draftDryRunPayload = dryRunResultSchema.parse(toneColorDryRunResultV1Schema.parse(draftDryRun.result));
if (draftDryRun.dispatchStatus !== 'completed') {
  throw new Error('agent draft session did not allow current active typed dry-run.');
}
const draftApply = await dispatchWithDraftSession(
  ToneColorAppServerToolName.ApplyCommand,
  buildTypedBasicToneCommand({
    acceptedPlanHash: draftDryRunPayload.dryRunPlanHash,
    acceptedPlanId: draftDryRunPayload.dryRunPlanId,
    dryRun: false,
    expectedGraphRevision: draftDryRunPayload.sourceGraphRevision,
    operationId: 'agent_dispatch_draft_apply_3163',
    patch: { contrast: 9 },
    sessionId: draftSession.sessionId,
  }),
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
    ToneColorAppServerToolName.ApplyCommand,
    buildTypedBasicToneCommand({
      acceptedPlanHash: draftDryRunPayload.dryRunPlanHash,
      acceptedPlanId: draftDryRunPayload.dryRunPlanId,
      dryRun: false,
      expectedGraphRevision: postDraftStatePayload.snapshot.graphRevision,
      operationId: `agent_dispatch_reject_${expectedMessage}`,
      patch: { contrast: 12 },
      sessionId: draftSession.sessionId,
    }),
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
  ToneColorAppServerToolName.ApplyCommand,
  buildTypedBasicToneCommand({
    acceptedPlanHash: dryRunPayload.dryRunPlanHash,
    acceptedPlanId: dryRunPayload.dryRunPlanId,
    dryRun: false,
    expectedGraphRevision: dryRunPayload.sourceGraphRevision,
    operationId: 'agent_dispatch_stale_3163',
    patch: { exposure: 0.5 },
    sessionId: 'agent-dispatch-3163',
  }),
  'dispatch-stale-1',
);
if (staleApply.dispatchStatus !== 'rejected' || !staleApply.message?.includes('stale graph revision')) {
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
