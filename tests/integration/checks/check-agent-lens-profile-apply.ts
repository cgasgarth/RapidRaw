#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerRouteMode,
} from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
  agentLensProfileApplyRequestSchema,
  applyAgentLensProfile,
} from '../../../src/utils/agentLensProfileApplyTool.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3169.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 3));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const lensProfileResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    afterPreviewHash: z.string().min(1),
    appliedGraphRevision: z.string().min(1),
    beforePreviewHash: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string()).min(1),
        operationId: z.literal('agent_lens_profile_3169'),
        sessionId: z.literal('agent-lens-profile-3169'),
        undoGraphRevision: z.literal('history_0'),
      })
      .passthrough(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_LENS_PROFILE_APPLY_TOOL_NAME),
    undoGraphRevision: z.literal('history_0'),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-lens-before',
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
    exif: { ISO: '400', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3169',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3169',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-lens-stale',
});

if (
  agentLensProfileApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    lensProfile: { lensDistortionAmount: 201 },
    operationId: 'invalid-distortion',
    requestId: 'invalid-distortion',
    sessionId: 'agent-lens-profile-invalid',
  }).success
) {
  throw new Error('agent.lens_profile.apply accepted out-of-range distortion amount.');
}
if (
  agentLensProfileApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    lensProfile: { lensMaker: null, lensModel: 'Impossible model' },
    operationId: 'invalid-maker-model',
    requestId: 'invalid-maker-model',
    sessionId: 'agent-lens-profile-invalid',
  }).success
) {
  throw new Error('agent.lens_profile.apply accepted a model while clearing maker.');
}
if (
  agentLensProfileApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    lensProfile: {},
    operationId: 'empty',
    requestId: 'empty',
    sessionId: 'agent-lens-profile-invalid',
  }).success
) {
  throw new Error('agent.lens_profile.apply accepted an empty patch.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentLensProfile({
    expectedRecipeHash: 'recipe:stale',
    lensProfile: { lensDistortionAmount: 90 },
    operationId: 'agent_lens_profile_stale',
    requestId: 'agent-lens-profile-stale',
    sessionId: 'agent-lens-profile-3169',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.lens_profile.apply did not reject stale recipe hash.');

const result = applyAgentLensProfile({
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  lensProfile: {
    lensCorrectionMode: 'manual',
    lensDistortionAmount: 87,
    lensDistortionEnabled: true,
    lensDistortionParams: {
      k1: 0.12,
      k2: -0.03,
      k3: 0.004,
      model: 1,
      tca_vb: -0.01,
      tca_vr: 0.02,
      vig_k1: -0.2,
      vig_k2: 0.05,
      vig_k3: -0.01,
    },
    lensMaker: 'Sony',
    lensModel: 'FE 24-70mm F2.8 GM II',
    lensTcaAmount: 94,
    lensTcaEnabled: true,
    lensVignetteAmount: 112,
    lensVignetteEnabled: true,
  },
  operationId: 'agent_lens_profile_3169',
  requestId: 'agent-lens-profile-3169',
  sessionId: 'agent-lens-profile-3169',
});
const parsedResult = lensProfileResultSchema.parse(result);
const state = useEditorStore.getState();
const afterSnapshot = buildAgentImageContextSnapshot();

if (
  state.adjustments.lensCorrectionMode !== 'manual' ||
  state.adjustments.lensDistortionAmount !== 87 ||
  state.adjustments.lensMaker !== 'Sony' ||
  state.adjustments.lensModel !== 'FE 24-70mm F2.8 GM II' ||
  state.adjustments.lensTcaAmount !== 94 ||
  state.adjustments.lensVignetteAmount !== 112 ||
  state.adjustments.lensDistortionParams?.k1 !== 0.12
) {
  throw new Error('agent.lens_profile.apply did not mutate representative lens/profile adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.lens_profile.apply must create undo history and invalidate stale preview output.');
}
if (parsedResult.beforePreviewHash === parsedResult.afterPreviewHash) {
  throw new Error('agent.lens_profile.apply did not update preview render identity.');
}
if (afterSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash) {
  throw new Error('agent lens/profile recipe hash did not change after apply.');
}
for (const field of [
  'lensCorrectionMode',
  'lensDistortionAmount',
  'lensDistortionEnabled',
  'lensDistortionParams',
  'lensMaker',
  'lensModel',
  'lensTcaAmount',
  'lensTcaEnabled',
  'lensVignetteAmount',
  'lensVignetteEnabled',
]) {
  if (!parsedResult.adjustedFields.includes(field)) {
    throw new Error(`agent.lens_profile.apply response missing adjusted field: ${field}`);
  }
}

const dispatched = dispatchResponseSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      lensProfile: { lensDistortionAmount: 91, lensVignetteAmount: 108 },
      operationId: 'agent_lens_profile_dispatch_3169',
      requestId: 'agent-lens-profile-dispatch-3169',
      sessionId: 'agent-lens-profile-3169',
    },
    requestId: 'agent-lens-profile-dispatch-host-3169',
    runtimeToolName: AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
);
if (dispatched.dispatchStatus !== 'completed') {
  throw new Error('agent.lens_profile.apply did not dispatch via app-server.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_LENS_PROFILE_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-lens-profile-apply')
) {
  throw new Error('agent.lens_profile.apply is missing from the mutating agent route catalog.');
}

console.log('agent lens/profile apply ok');
