#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerRouteMode,
} from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_COLOR_APPLY_TOOL_NAME,
  agentColorApplyRequestSchema,
  applyAgentColor,
} from '../../../src/utils/agentColorApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import { TONE_CURVE_PARAMETRIC_PRESETS } from '../../../src/utils/profileTonePresets.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3167.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 14 : 2));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const colorResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    afterPreviewHash: z.string().min(1),
    appliedGraphRevision: z.string().min(1),
    beforePreviewHash: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string()).min(1),
        operationId: z.literal('agent_color_3167'),
        sessionId: z.literal('agent-color-3167'),
        undoGraphRevision: z.literal('history_0'),
      })
      .passthrough(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_COLOR_APPLY_TOOL_NAME),
    undoGraphRevision: z.literal('history_0'),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-color-before',
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
    exif: { ISO: '500', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3167',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3167',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-color-stale',
});

if (
  agentColorApplyRequestSchema.safeParse({
    color: { hsl: { oranges: { hue: 181, luminance: 0, saturation: 0 } } },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-hsl',
    requestId: 'invalid-hsl',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted out-of-range HSL hue.');
}
if (
  agentColorApplyRequestSchema.safeParse({
    color: {
      colorBalanceRgb: {
        enabled: true,
        highlights: { red: 0, green: 0, blue: 0 },
        midtones: { red: 0, green: 0, blue: 0 },
        preserveLuminance: true,
        shadows: { red: 0, green: 0, blue: 0 },
      },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-rgb-balance',
    requestId: 'invalid-rgb-balance',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted enabled RGB balance without channel edits.');
}
if (
  agentColorApplyRequestSchema.safeParse({
    color: {
      selectiveColorRangeControls: { reds: { centerHueDegrees: 10, falloffSmoothness: 0.1, widthDegrees: 35 } },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-range-control',
    requestId: 'invalid-range-control',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted invalid selective range falloff.');
}
if (
  agentColorApplyRequestSchema.safeParse({
    color: {
      cameraProfile: 'camera_flat',
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-camera-profile',
    requestId: 'invalid-camera-profile',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted an invalid camera profile.');
}
if (
  agentColorApplyRequestSchema.safeParse({
    color: {
      toneCurve: 'crush_shadows',
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-tone-curve',
    requestId: 'invalid-tone-curve',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted an invalid tone curve.');
}
if (
  agentColorApplyRequestSchema.safeParse({
    color: {
      skinToneUniformity: {
        enabled: true,
        hueUniformity: 0.9,
        luminanceUniformity: 0.2,
        maxHueShiftDegrees: 18,
        saturationUniformity: 0.2,
        targetHueDegrees: 28,
        targetLuminance: 0.58,
        targetSaturation: 0.42,
      },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-skin-tone-uniformity',
    requestId: 'invalid-skin-tone-uniformity',
    sessionId: 'agent-color-invalid',
  }).success
) {
  throw new Error('agent.color.apply accepted out-of-range skin-tone uniformity.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentColor({
    color: { vibrance: 8 },
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_color_stale',
    requestId: 'agent-color-stale',
    sessionId: 'agent-color-3167',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.color.apply did not reject stale recipe hash.');

const result = applyAgentColor({
  color: {
    blackWhiteMixer: {
      enabled: true,
      weights: { aquas: 0, blues: -8, greens: 0, magentas: 0, oranges: 12, purples: 0, reds: 10, yellows: 6 },
    },
    cameraProfile: 'camera_portrait',
    channelMixer: {
      blue: { red: 0, green: 2, blue: 98, constant: 0 },
      enabled: true,
      green: { red: 0, green: 100, blue: 0, constant: 0 },
      preserveLuminance: true,
      red: { red: 104, green: -2, blue: 0, constant: 0 },
    },
    colorBalanceRgb: {
      enabled: true,
      highlights: { red: 6, green: 0, blue: -4 },
      midtones: { red: 2, green: 0, blue: -2 },
      preserveLuminance: true,
      shadows: { red: -2, green: 0, blue: 5 },
    },
    colorCalibration: {
      blueHue: 2,
      blueSaturation: 4,
      greenHue: -2,
      greenSaturation: 3,
      redHue: 4,
      redSaturation: 8,
      shadowsTint: -3,
    },
    colorGrading: {
      balance: 12,
      blending: 58,
      global: { hue: 35, luminance: 0, saturation: 3 },
      highlights: { hue: 42, luminance: 1, saturation: 7 },
      midtones: { hue: 32, luminance: 0, saturation: 5 },
      shadows: { hue: 215, luminance: -2, saturation: 8 },
    },
    hsl: {
      oranges: { hue: -4, luminance: 5, saturation: 12 },
      blues: { hue: 2, luminance: -3, saturation: 8 },
    },
    saturation: 5,
    selectiveColorRangeControls: {
      oranges: { centerHueDegrees: 27, falloffSmoothness: 1.6, widthDegrees: 42 },
    },
    skinToneUniformity: {
      enabled: true,
      hueUniformity: 0.38,
      luminanceUniformity: 0.14,
      maxHueShiftDegrees: 18,
      saturationUniformity: 0.22,
      targetHueDegrees: 28,
      targetLuminance: 0.58,
      targetSaturation: 0.42,
    },
    temperature: 8,
    tint: -3,
    toneCurve: 'soft_contrast',
    vibrance: 14,
  },
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_color_3167',
  requestId: 'agent-color-3167',
  sessionId: 'agent-color-3167',
});
const parsedResult = colorResultSchema.parse(result);
const state = useEditorStore.getState();
const afterSnapshot = buildAgentImageContextSnapshot();

if (
  state.adjustments.temperature !== 8 ||
  state.adjustments.tint !== -3 ||
  state.adjustments.vibrance !== 14 ||
  state.adjustments.hsl.oranges.saturation !== 12 ||
  state.adjustments.colorGrading.highlights.saturation !== 7 ||
  state.adjustments.colorBalanceRgb.highlights.red !== 6 ||
  state.adjustments.channelMixer.red.red !== 104 ||
  state.adjustments.blackWhiteMixer.weights.oranges !== 12 ||
  state.adjustments.cameraProfile !== 'camera_portrait' ||
  state.adjustments.colorCalibration.redSaturation !== 8 ||
  state.adjustments.skinToneUniformity.hueUniformity !== 0.38 ||
  state.adjustments.selectiveColorRangeControls.oranges.widthDegrees !== 42 ||
  state.adjustments.toneCurve !== 'soft_contrast' ||
  state.adjustments.curveMode !== 'parametric' ||
  state.adjustments.parametricCurve.luma.highlights !== TONE_CURVE_PARAMETRIC_PRESETS.soft_contrast.highlights
) {
  throw new Error('agent.color.apply did not mutate representative color adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.color.apply must create undo history and invalidate stale preview output.');
}
if (parsedResult.beforePreviewHash === parsedResult.afterPreviewHash) {
  throw new Error('agent.color.apply did not update preview render identity.');
}
if (afterSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash) {
  throw new Error('agent color recipe hash did not change after apply.');
}
for (const field of [
  'blackWhiteMixer',
  'cameraProfile',
  'channelMixer',
  'colorBalanceRgb',
  'colorCalibration',
  'colorGrading',
  'hsl',
  'saturation',
  'selectiveColorRangeControls',
  'skinToneUniformity',
  'temperature',
  'tint',
  'toneCurve',
  'vibrance',
]) {
  if (!parsedResult.adjustedFields.includes(field)) {
    throw new Error(`agent.color.apply response missing adjusted field: ${field}`);
  }
}

const dispatched = dispatchResponseSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      color: { hsl: { reds: { hue: 1, luminance: 0, saturation: 4 } } },
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      operationId: 'agent_color_dispatch_3167',
      requestId: 'agent-color-dispatch-3167',
      sessionId: 'agent-color-3167',
    },
    requestId: 'agent-color-dispatch-host-3167',
    runtimeToolName: AGENT_COLOR_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
);
if (dispatched.dispatchStatus !== 'completed') throw new Error('agent.color.apply did not dispatch via app-server.');

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_COLOR_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-color-apply')
) {
  throw new Error('agent.color.apply is missing from the mutating agent route catalog.');
}

console.log('agent color apply ok');
