#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerRouteMode,
} from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { buildAgentImageContextSnapshot } from '../../../../src/utils/agent/context/agentImageContextSnapshot.ts';
import {
  AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
  agentCurveLevelsApplyRequestSchema,
  applyAgentCurveLevels,
} from '../../../../src/utils/agent/tools/agentCurveLevelsApplyTool.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3166.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 2));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const curveLevelsResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    afterPreviewHash: z.string().min(1),
    appliedGraphRevision: z.string().min(1),
    beforePreviewHash: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string()).min(1),
        operationId: z.literal('agent_curve_levels_3166'),
        sessionId: z.literal('agent-curve-levels-3166'),
        undoGraphRevision: z.literal('history_0'),
      })
      .passthrough(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_CURVE_LEVELS_APPLY_TOOL_NAME),
    undoGraphRevision: z.literal('history_0'),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-curve-levels-before',
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
    exif: { ISO: '800', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3166',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3166',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-curve-levels-stale',
});

if (
  agentCurveLevelsApplyRequestSchema.safeParse({
    curveLevels: {
      levels: { enabled: true, gamma: 1, inputBlack: 0.8, inputWhite: 0.7, outputBlack: 0, outputWhite: 1 },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-levels',
    requestId: 'invalid-levels',
    sessionId: 'agent-curve-levels-invalid',
  }).success
) {
  throw new Error('agent.curve_levels.apply accepted invalid levels ordering.');
}
if (
  agentCurveLevelsApplyRequestSchema.safeParse({
    curveLevels: {
      pointCurves: {
        luma: [
          { x: 100, y: 100 },
          { x: 50, y: 80 },
        ],
      },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-point-curve',
    requestId: 'invalid-point-curve',
    sessionId: 'agent-curve-levels-invalid',
  }).success
) {
  throw new Error('agent.curve_levels.apply accepted unordered point curve controls.');
}
if (
  agentCurveLevelsApplyRequestSchema.safeParse({
    curveLevels: {
      parametricCurve: {
        luma: {
          blackLevel: 0,
          darks: 0,
          highlights: 0,
          lights: 0,
          shadows: 0,
          split1: 70,
          split2: 50,
          split3: 80,
          whiteLevel: 0,
        },
      },
    },
    expectedRecipeHash: 'recipe:test',
    operationId: 'invalid-parametric',
    requestId: 'invalid-parametric',
    sessionId: 'agent-curve-levels-invalid',
  }).success
) {
  throw new Error('agent.curve_levels.apply accepted unordered parametric splits.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  await applyAgentCurveLevels({
    curveLevels: { toneCurve: 'linear' },
    expectedRecipeHash: 'recipe:stale',
    operationId: 'agent_curve_levels_stale',
    requestId: 'agent-curve-levels-stale',
    sessionId: 'agent-curve-levels-3166',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.curve_levels.apply did not reject stale recipe hash.');

const result = await applyAgentCurveLevels({
  curveLevels: {
    curveMode: 'parametric',
    levels: { enabled: true, gamma: 0.94, inputBlack: 0.02, inputWhite: 0.98, outputBlack: 0.01, outputWhite: 0.99 },
    parametricCurve: {
      luma: {
        blackLevel: -2,
        darks: -4,
        highlights: 6,
        lights: 5,
        shadows: 8,
        split1: 20,
        split2: 52,
        split3: 82,
        whiteLevel: 2,
      },
    },
    pointCurves: {
      red: [
        { x: 0, y: 0 },
        { x: 128, y: 134 },
        { x: 255, y: 255 },
      ],
    },
    toneCurve: 'soft_contrast',
  },
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  operationId: 'agent_curve_levels_3166',
  requestId: 'agent-curve-levels-3166',
  sessionId: 'agent-curve-levels-3166',
});
const parsedResult = curveLevelsResultSchema.parse(result);
const state = useEditorStore.getState();
const afterSnapshot = buildAgentImageContextSnapshot();

if (
  state.adjustments.curveMode !== 'parametric' ||
  state.adjustments.toneCurve !== 'soft_contrast' ||
  state.adjustments.levels.gamma !== 0.94 ||
  state.adjustments.parametricCurve?.luma.shadows !== 8 ||
  state.adjustments.pointCurves?.red[1]?.y !== 134
) {
  throw new Error('agent.curve_levels.apply did not mutate curves/levels adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.curve_levels.apply must create undo history and invalidate stale preview output.');
}
if (parsedResult.beforePreviewHash === parsedResult.afterPreviewHash) {
  throw new Error('agent.curve_levels.apply did not update preview render identity.');
}
if (afterSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash) {
  throw new Error('agent curve/levels recipe hash did not change after apply.');
}
for (const field of ['curveMode', 'levels', 'parametricCurve', 'pointCurves', 'toneCurve']) {
  if (!parsedResult.adjustedFields.includes(field)) {
    throw new Error(`agent.curve_levels.apply response missing adjusted field: ${field}`);
  }
}

const dispatched = dispatchResponseSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      curveLevels: {
        levels: { enabled: false, gamma: 1, inputBlack: 0, inputWhite: 1, outputBlack: 0, outputWhite: 1 },
      },
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      operationId: 'agent_curve_levels_dispatch_3166',
      requestId: 'agent-curve-levels-dispatch-3166',
      sessionId: 'agent-curve-levels-3166',
    },
    requestId: 'agent-curve-levels-dispatch-host-3166',
    runtimeToolName: AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
);
if (dispatched.dispatchStatus !== 'completed') {
  throw new Error('agent.curve_levels.apply did not dispatch via app-server.');
}

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_CURVE_LEVELS_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-curve-levels-apply')
) {
  throw new Error('agent.curve_levels.apply is missing from the mutating agent route catalog.');
}

console.log('agent curve/levels apply ok');
