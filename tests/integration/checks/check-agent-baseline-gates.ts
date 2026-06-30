#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../src/components/panel/right/Masks.tsx';
import {
  RawEngineAppServerHostToolName,
  RawEngineAppServerStructuredErrorCode,
  RawEngineAppServerSupervisorEventKind,
  RawEngineAppServerSupervisorPhase,
  rawEngineAppServerSupervisorStateSchema,
} from '../../../src/schemas/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import {
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
} from '../../../src/utils/agentAdjustmentApplyTool.ts';
import { AGENT_COLOR_APPLY_TOOL_NAME } from '../../../src/utils/agentColorApplyTool.ts';
import { AGENT_CURVE_LEVELS_APPLY_TOOL_NAME } from '../../../src/utils/agentCurveLevelsApplyTool.ts';
import { AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME } from '../../../src/utils/agentDetailEffectsApplyTool.ts';
import { AGENT_GEOMETRY_APPLY_TOOL_NAME } from '../../../src/utils/agentGeometryApplyTool.ts';
import { AGENT_LENS_PROFILE_APPLY_TOOL_NAME } from '../../../src/utils/agentLensProfileApplyTool.ts';
import {
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
} from '../../../src/utils/agentReadOnlyAppServerTools.ts';
import {
  createRawEngineAppServerSupervisorState,
  failRawEngineAppServerSupervisor,
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
  startRawEngineAppServerSupervisor,
} from '../../../src/utils/rawEngineAppServerHost.ts';
import { AGENT_RETOUCH_APPLY_TOOL_NAME } from '../../../src/utils/agentRetouchApplyTool.ts';
import { AGENT_HISTORY_ROLLBACK_TOOL_NAME } from '../../../src/utils/agentSessionHistory.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3164.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 18 : 2));
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
        activeImagePath: z.string().min(1),
        graphRevision: z.string().min(1),
        initialPreview: z
          .object({
            encodedFormat: z.literal('jpeg'),
            includesOriginalRaw: z.literal(false),
            longEdgePx: z.literal(1536),
            mediaType: z.literal('image/jpeg'),
            previewRef: z.string().min(1),
            purpose: z.literal('initial_context'),
            quality: z.literal(0.86),
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
        height: z.number().int().positive(),
        includesOriginalRaw: z.literal(false),
        longEdgePx: z.number().int().positive(),
        maxPixelCount: z.number().int().positive(),
        purpose: z.enum(['detail_review', 'initial_context', 'refresh']),
        recipeHash: z.string().min(1),
        renderHash: z.string().min(1),
        width: z.number().int().positive(),
      })
      .passthrough(),
    staleRecipeHash: z.boolean(),
  })
  .passthrough();
const dryRunResultSchema = z
  .object({
    dryRunPlanHash: z.string().min(1),
    dryRunPlanId: z.string().min(1),
    sourceGraphRevision: z.string().min(1),
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

const assertRejected = (response: z.infer<typeof dispatchResponseSchema>, label: string, messageFragment: string) => {
  if (response.dispatchStatus !== 'rejected' || response.message?.includes(messageFragment) !== true) {
    throw new Error(`${label} should reject with ${messageFragment}.`);
  }
};

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: null,
  hasRenderedFirstFrame: false,
  histogram: null,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: null,
});

assertRejected(
  await dispatch(AGENT_PREVIEW_RENDER_TOOL_NAME, { requestId: 'agent-baseline-no-image' }, 'agent-baseline-no-image'),
  'preview without selected image',
  'selected image',
);

useEditorStore.getState().setEditor({
  adjustments: { ...INITIAL_ADJUSTMENTS, exposure: 0.2, highlights: -10 },
  brushSettings: { feather: 50, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-baseline-before',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, exposure: 0.2, highlights: -10 }],
  historyIndex: 1,
  selectedImage: {
    exif: { ISO: '400', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3164',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3164',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const initialState = await dispatch(AGENT_STATE_GET_TOOL_NAME, { requestId: 'agent-baseline-state' }, 'baseline-state');
if (initialState.dispatchStatus !== 'completed') throw new Error('agent.state.get baseline dispatch failed.');
const statePayload = stateResultSchema.parse(initialState.result);
if (
  statePayload.snapshot.activeImagePath !== selectedPath ||
  statePayload.snapshot.initialPreview.previewRef !== 'blob:rawengine-agent-baseline-before'
) {
  throw new Error('agent baseline state did not bind to the selected RAW preview.');
}

const preview = await dispatch(
  AGENT_PREVIEW_RENDER_TOOL_NAME,
  {
    expectedRecipeHash: statePayload.snapshot.initialPreview.recipeHash,
    longEdgePx: 1024,
    maxPixelCount: 600_000,
    purpose: 'refresh',
    requestId: 'agent-baseline-preview',
  },
  'baseline-preview',
);
if (preview.dispatchStatus !== 'completed') throw new Error('agent.preview.render baseline dispatch failed.');
const previewPayload = previewResultSchema.parse(preview.result);
if (
  previewPayload.staleRecipeHash ||
  previewPayload.preview.purpose !== 'refresh' ||
  previewPayload.preview.longEdgePx !== 1024 ||
  previewPayload.preview.width * previewPayload.preview.height > 600_000
) {
  throw new Error('agent baseline preview did not preserve bounded refresh semantics.');
}

assertRejected(
  await dispatch(
    AGENT_PREVIEW_RENDER_TOOL_NAME,
    { longEdgePx: 4096, requestId: 'agent-baseline-oversized-preview' },
    'baseline-oversized-preview',
  ),
  'oversized preview',
  'Too big',
);
assertRejected(
  await dispatch('rawengine.agent.unknown_tool', { requestId: 'agent-baseline-unknown' }, 'baseline-unknown'),
  'unknown agent tool',
  'not an approved typed agent app-server tool',
);

const dryRun = await dispatch(
  AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME,
  {
    adjustments: { exposure: 0.4 },
    expectedGraphRevision: statePayload.snapshot.graphRevision,
    expectedRecipeHash: statePayload.snapshot.initialPreview.recipeHash,
    operationId: 'agent_baseline_apply',
    requestId: 'agent-baseline-dry-run',
    sessionId: 'agent-baseline',
  },
  'baseline-dry-run',
);
if (dryRun.dispatchStatus !== 'completed') throw new Error('agent baseline dry-run dispatch failed.');
const dryRunPayload = dryRunResultSchema.parse(dryRun.result);
const apply = await dispatch(
  AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
  {
    acceptedPlanHash: dryRunPayload.dryRunPlanHash,
    acceptedPlanId: dryRunPayload.dryRunPlanId,
    adjustments: { exposure: 0.4 },
    expectedGraphRevision: dryRunPayload.sourceGraphRevision,
    expectedRecipeHash: statePayload.snapshot.initialPreview.recipeHash,
    operationId: 'agent_baseline_apply',
    requestId: 'agent-baseline-apply',
    sessionId: 'agent-baseline',
  },
  'baseline-apply',
);
if (apply.dispatchStatus !== 'completed') throw new Error('agent baseline apply dispatch failed.');
assertRejected(
  await dispatch(
    AGENT_ADJUSTMENTS_APPLY_TOOL_NAME,
    {
      acceptedPlanHash: dryRunPayload.dryRunPlanHash,
      acceptedPlanId: dryRunPayload.dryRunPlanId,
      adjustments: { exposure: 0.5 },
      expectedGraphRevision: dryRunPayload.sourceGraphRevision,
      expectedRecipeHash: statePayload.snapshot.initialPreview.recipeHash,
      operationId: 'agent_baseline_stale_apply',
      requestId: 'agent-baseline-stale-apply',
      sessionId: 'agent-baseline',
    },
    'baseline-stale-apply',
  ),
  'stale apply',
  'stale recipe hash',
);

const catalog = buildRawEngineAppServerRouteCatalog();
for (const [toolName, expectedCheck] of [
  [AGENT_STATE_GET_TOOL_NAME, 'check:agent-readonly-tools'],
  [AGENT_PREVIEW_RENDER_TOOL_NAME, 'check:agent-readonly-tools'],
  [AGENT_PREVIEW_COMPARE_TOOL_NAME, 'check:agent-preview-compare-loop'],
  [AGENT_ADJUSTMENTS_DRY_RUN_TOOL_NAME, 'check:agent-adjustments-apply'],
  [AGENT_ADJUSTMENTS_APPLY_TOOL_NAME, 'check:agent-adjustments-apply'],
  [AGENT_COLOR_APPLY_TOOL_NAME, 'check:agent-color-apply'],
  [AGENT_CURVE_LEVELS_APPLY_TOOL_NAME, 'check:agent-curve-levels-apply'],
  [AGENT_DETAIL_EFFECTS_APPLY_TOOL_NAME, 'check:agent-detail-effects-apply'],
  [AGENT_GEOMETRY_APPLY_TOOL_NAME, 'check:agent-geometry-apply'],
  [AGENT_LENS_PROFILE_APPLY_TOOL_NAME, 'check:agent-lens-profile-apply'],
  [AGENT_HISTORY_ROLLBACK_TOOL_NAME, 'check:agent-session-history-rollback'],
  [AGENT_RETOUCH_APPLY_TOOL_NAME, 'check:agent-retouch-apply'],
] satisfies [string, string][]) {
  const route = catalog.find((candidate) => candidate.commandName === toolName);
  if (route === undefined || route.family !== 'agent' || !route.runtimeCheckScripts.includes(expectedCheck)) {
    throw new Error(`${toolName} missing agent catalog runtime gate ${expectedCheck}.`);
  }
}

const supervisor = startRawEngineAppServerSupervisor({
  processId: 4242,
  state: createRawEngineAppServerSupervisorState({
    command: ['codex', 'app-server', '--stdio'],
    supervisorId: 'agent-baseline-supervisor',
    timestampIso: '2026-06-26T12:00:00.000Z',
  }),
  timestampIso: '2026-06-26T12:00:01.000Z',
});
const failedSupervisor = rawEngineAppServerSupervisorStateSchema.parse(
  failRawEngineAppServerSupervisor({
    error: {
      code: RawEngineAppServerStructuredErrorCode.HealthTimeout,
      message: 'App-server health check did not report initialized before timeout.',
      recoverable: true,
    },
    state: supervisor,
    timestampIso: '2026-06-26T12:00:02.000Z',
  }),
);
if (
  failedSupervisor.phase !== RawEngineAppServerSupervisorPhase.Stopped ||
  failedSupervisor.error?.recoverable !== true ||
  !failedSupervisor.auditEvents.some((event) => event.kind === RawEngineAppServerSupervisorEventKind.Fail)
) {
  throw new Error('agent app-server launch failure must remain recoverable and audit-visible.');
}

console.log('agent baseline gates ok');
