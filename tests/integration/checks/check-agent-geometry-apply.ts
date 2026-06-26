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
  AGENT_GEOMETRY_APPLY_TOOL_NAME,
  agentGeometryApplyRequestSchema,
  applyAgentGeometry,
} from '../../../src/utils/agentGeometryApplyTool.ts';
import { buildAgentImageContextSnapshot } from '../../../src/utils/agentImageContextSnapshot.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3165.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 2));
const dispatchResponseSchema = z
  .object({
    dispatchStatus: z.enum(['completed', 'rejected']),
    message: z.string().optional(),
    result: z.unknown().optional(),
  })
  .passthrough();
const geometryResultSchema = z
  .object({
    adjustedFields: z.array(z.string()).min(1),
    afterPreviewHash: z.string().min(1),
    appliedGraphRevision: z.string().min(1),
    beforePreviewHash: z.string().min(1),
    changedPixelCount: z.number().int().positive(),
    receipt: z
      .object({
        adjustedFields: z.array(z.string()).min(1),
        operationId: z.literal('agent_geometry_3165'),
        sessionId: z.literal('agent-geometry-3165'),
        undoGraphRevision: z.literal('history_0'),
      })
      .passthrough(),
    staleRecipeHash: z.literal(false),
    toolName: z.literal(AGENT_GEOMETRY_APPLY_TOOL_NAME),
    undoGraphRevision: z.literal('history_0'),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-geometry-before',
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
    originalUrl: 'blob:rawengine-original-3165',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3165',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: 'blob:rawengine-agent-geometry-stale',
});

if (
  agentGeometryApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    geometry: { crop: { height: 50, unit: '%', width: 60, x: 50, y: 0 } },
    operationId: 'invalid-crop',
    requestId: 'invalid-crop',
    sessionId: 'agent-geometry-invalid',
  }).success
) {
  throw new Error('agent.geometry.apply accepted crop bounds outside the image.');
}
if (
  agentGeometryApplyRequestSchema.safeParse({
    expectedRecipeHash: 'recipe:test',
    geometry: { rotation: 90 },
    operationId: 'invalid-rotation',
    requestId: 'invalid-rotation',
    sessionId: 'agent-geometry-invalid',
  }).success
) {
  throw new Error('agent.geometry.apply accepted out-of-range rotation.');
}

const initialSnapshot = buildAgentImageContextSnapshot();
let staleRejected = false;
try {
  applyAgentGeometry({
    expectedRecipeHash: 'recipe:stale',
    geometry: { rotation: 1 },
    operationId: 'agent_geometry_stale',
    requestId: 'agent-geometry-stale',
    sessionId: 'agent-geometry-3165',
  });
} catch {
  staleRejected = true;
}
if (!staleRejected) throw new Error('agent.geometry.apply did not reject stale recipe hash.');

const result = applyAgentGeometry({
  expectedRecipeHash: initialSnapshot.initialPreview.recipeHash,
  geometry: {
    aspectRatio: 1.5,
    crop: { height: 68, unit: '%', width: 82, x: 8, y: 10 },
    flipHorizontal: true,
    rotation: 1.25,
    transformScale: 1.08,
    transformXOffset: -3,
  },
  operationId: 'agent_geometry_3165',
  requestId: 'agent-geometry-3165',
  sessionId: 'agent-geometry-3165',
});
const parsedResult = geometryResultSchema.parse(result);
const state = useEditorStore.getState();
const afterSnapshot = buildAgentImageContextSnapshot();

if (
  state.adjustments.crop?.x !== 8 ||
  state.adjustments.rotation !== 1.25 ||
  !state.adjustments.flipHorizontal ||
  state.adjustments.transformScale !== 1.08
) {
  throw new Error('agent.geometry.apply did not mutate crop/geometry adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2 || state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('agent.geometry.apply must create undo history and invalidate stale preview output.');
}
if (parsedResult.beforePreviewHash === parsedResult.afterPreviewHash) {
  throw new Error('agent.geometry.apply did not update the preview recipe/render identity.');
}
if (afterSnapshot.initialPreview.recipeHash === initialSnapshot.initialPreview.recipeHash) {
  throw new Error('agent geometry recipe hash did not change after geometry apply.');
}
for (const field of ['aspectRatio', 'crop', 'flipHorizontal', 'rotation', 'transformScale', 'transformXOffset']) {
  if (!parsedResult.adjustedFields.includes(field)) {
    throw new Error(`agent.geometry.apply response missing adjusted field: ${field}`);
  }
}

const dispatched = dispatchResponseSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      expectedRecipeHash: afterSnapshot.initialPreview.recipeHash,
      geometry: { flipVertical: true, orientationSteps: 1 },
      operationId: 'agent_geometry_dispatch_3165',
      requestId: 'agent-geometry-dispatch-3165',
      sessionId: 'agent-geometry-3165',
    },
    requestId: 'agent-geometry-dispatch-host-3165',
    runtimeToolName: AGENT_GEOMETRY_APPLY_TOOL_NAME,
    toolName: RawEngineAppServerHostToolName.DispatchTool,
  }),
);
if (dispatched.dispatchStatus !== 'completed') throw new Error('agent.geometry.apply did not dispatch via app-server.');

const route = buildRawEngineAppServerRouteCatalog().find(
  (candidate) => candidate.commandName === AGENT_GEOMETRY_APPLY_TOOL_NAME,
);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.ApplyDryRunPlan) ||
  !route.runtimeCheckScripts.includes('check:agent-geometry-apply')
) {
  throw new Error('agent.geometry.apply is missing from the mutating agent route catalog.');
}

console.log('agent geometry apply ok');
