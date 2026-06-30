#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/layers/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerRouteMode,
} from '../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
  agentDetailEffectsApplyRequestSchema,
  applyAgentDetailEffects,
} from '../../../src/utils/agent/tools/agentDetailEffectsApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3168.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 3));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const detailEffectsResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    afterPreviewHash: z.string().min(1),
    appliedGraphRevision: z.string().min(1),
    beforePreviewHash: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string()).min(1),
        operationId: z.literal('agent_detail_effects_3168'),
        sessionId: z.literal('agent-detail-effects-3168'),
        undoGraphRevision: z.literal('history_0'),
      })
      .passthrough(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME),
    undoGraphRevision: z.literal('history_0'),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-detail-effects-before',
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
    exif: { ISO: '640', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3168',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3168',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-detail-effects-stale',
});

if (
  agentDetailEffectsApplyRequestSchema.safeParse({
    detailEffects: { deblurSigmaPx: 0.2 },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-deblur-sigma',
    requestId: 'invalid-deblur-sigma',
    sessionId: 'agent-detail-effects-invalid',
  }).success
) {
  throw new Error('agent.detail_effects.apply accepted out-of-range deblur sigma.');
}
if (
  agentDetailEffectsApplyRequestSchema.safeParse({
    detailEffects: { grainAmount: 101 },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-grain',
    requestId: 'invalid-grain',
    sessionId: 'agent-detail-effects-invalid',
  }).success
) {
  throw new Error('agent.detail_effects.apply accepted out-of-range grain.');
}
if (
  agentDetailEffectsApplyRequestSchema.safeParse({
    detailEffects: {},
    expectedRecipeHash: 'recipe:test',
    operationId: 'empty',
    requestId: 'empty',
    sessionId: 'agent-detail-effects-invalid',
  }).success
) {
  throw new Error('agent.detail_effects.apply accepted an empty patch.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentDetailEffects({
    detailEffects: { sharpness: 12 },
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_detail_effects_stale',
    requestId: 'agent-detail-effects-stale',
    sessionId: 'agent-detail-effects-3168',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.detail_effects.apply did not reject stale recipe hash.');

const result = applyAgentDetailEffects({
  detailEffects: {
    chromaticAberrationBlueYellow: -3,
    chromaticAberrationRedCyan: 4,
    clarity: 9,
    colorNoiseReduction: 12,
    deblurEnabled: true,
    deblurSigmaPx: 0.9,
    deblurStrength: 24,
    dehaze: 7,
    dustSpotMinRadiusPx: 3,
    dustSpotOverlayEnabled: true,
    dustSpotSensitivity: 62,
    flareAmount: 4,
    glowAmount: 6,
    grainAmount: 18,
    grainRoughness: 57,
    grainSize: 32,
    halationAmount: 5,
    localContrastHaloGuard: 58,
    localContrastMidtoneMask: 44,
    localContrastRadiusPx: 32,
    lumaNoiseReduction: 16,
    sharpness: 18,
    sharpnessThreshold: 20,
    structure: 11,
    vignetteAmount: -14,
    vignetteFeather: 64,
    vignetteMidpoint: 48,
    vignetteRoundness: 6,
  },
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_detail_effects_3168',
  requestId: 'agent-detail-effects-3168',
  sessionId: 'agent-detail-effects-3168',
});
const parsedResult = detailEffectsResultSchema.parse(result);
const state = useEditorStore.getState();
const afterSnapshot = buildAgentImageContextSnapshot();

if (
  state.adjustments.deblurEnabled !== true ||
  state.adjustments.deblurSigmaPx !== 0.9 ||
  state.adjustments.deblurStrength !== 24 ||
  state.adjustments.sharpness !== 18 ||
  state.adjustments.lumaNoiseReduction !== 16 ||
  state.adjustments.colorNoiseReduction !== 12 ||
  state.adjustments.localContrastRadiusPx !== 32 ||
  state.adjustments.dustSpotOverlayEnabled !== true ||
  state.adjustments.dustSpotSensitivity !== 62 ||
  state.adjustments.grainAmount !== 18 ||
  state.adjustments.vignetteAmount !== -14 ||
  state.adjustments.glowAmount !== 6 ||
  state.adjustments.halationAmount !== 5 ||
  state.adjustments.flareAmount !== 4
) {
  throw new Error('agent.detail_effects.apply did not mutate representative detail/effects adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.detail_effects.apply must create undo history and invalidate stale preview output.');
}
if (parsedResult.beforePreviewHash === parsedResult.afterPreviewHash) {
  throw new Error('agent.detail_effects.apply did not update preview render identity.');
}
if (afterSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash) {
  throw new Error('agent detail/effects recipe hash did not change after apply.');
}
for (const field of [
  'chromaticAberrationBlueYellow',
  'chromaticAberrationRedCyan',
  'clarity',
  'colorNoiseReduction',
  'deblurEnabled',
  'deblurSigmaPx',
  'deblurStrength',
  'dehaze',
  'dustSpotMinRadiusPx',
  'dustSpotOverlayEnabled',
  'dustSpotSensitivity',
  'flareAmount',
  'glowAmount',
  'grainAmount',
  'grainRoughness',
  'grainSize',
  'halationAmount',
  'localContrastHaloGuard',
  'localContrastMidtoneMask',
  'localContrastRadiusPx',
  'lumaNoiseReduction',
  'sharpness',
  'sharpnessThreshold',
  'structure',
  'vignetteAmount',
  'vignetteFeather',
  'vignetteMidpoint',
  'vignetteRoundness',
]) {
  if (!parsedResult.adjustedFields.includes(field)) {
    throw new Error(`agent.detail_effects.apply response missing adjusted field: ${field}`);
  }
}

const dispatched = dispatchResponseSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      detailEffects: { sharpness: 22, grainAmount: 20 },
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      operationId: 'agent_detail_effects_dispatch_3168',
      requestId: 'agent-detail-effects-dispatch-3168',
      sessionId: 'agent-detail-effects-3168',
    },
    requestId: 'agent-detail-effects-dispatch-host-3168',
    runtimeToolName: AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
);
if (dispatched.dispatchStatus !== 'completed') {
  throw new Error('agent.detail_effects.apply did not dispatch via app-server.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-detail-effects-apply')
) {
  throw new Error('agent.detail_effects.apply is missing from the mutating agent route catalog.');
}

console.log('agent detail/effects apply ok');
