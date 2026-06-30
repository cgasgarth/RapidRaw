#!/usr/bin/env bun

import { z } from 'zod';

import { ToolType } from '../../../../src/components/panel/right/layers/Masks.tsx';
import { RawEngineAppServerRouteMode } from '../../../../src/schemas/agent/agentRuntimeSchemas.ts';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  AGENT_PREVIEW_COMPARE_TOOL_NAME,
  AGENT_STATE_GET_TOOL_NAME,
  agentPreviewCompareRequestSchema,
  agentPreviewCompareResponseSchema,
  getAgentReadOnlyState,
  renderAgentPreviewCompare,
} from '../../../../src/utils/agentReadOnlyAppServerTools.ts';
import {
  buildRawEngineAppServerRouteCatalog,
  handleRawEngineAppServerHostRequestAsync,
} from '../../../../src/utils/rawEngineAppServerHost.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3160.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 12 : 2));
const dispatchResultSchema = z
  .object({
    dispatchStatus: z.literal('completed'),
    result: agentPreviewCompareResponseSchema,
    runtimeToolName: z.literal(AGENT_PREVIEW_COMPARE_TOOL_NAME),
  })
  .passthrough();

useEditorStore.getState().setEditor({
  adjustments: { ...INITIAL_ADJUSTMENTS, contrast: 8, exposure: 0.25, highlights: -10 },
  brushSettings: { feather: 44, size: 72, tool: ToolType.Brush },
  finalPreviewUrl: 'blob:rawengine-agent-preview-compare-current',
  hasRenderedFirstFrame: true,
  histogram: {
    [ActiveChannel.Blue]: { color: '#4D96FF', data: bins },
    [ActiveChannel.Green]: { color: '#6BCB77', data: bins },
    [ActiveChannel.Luma]: { color: '#FFFFFF', data: bins },
    [ActiveChannel.Red]: { color: '#FF6B6B', data: bins },
  },
  history: [INITIAL_ADJUSTMENTS, { ...INITIAL_ADJUSTMENTS, contrast: 8, exposure: 0.25, highlights: -10 }],
  historyIndex: 1,
  selectedImage: {
    exif: { ISO: '500', LensModel: 'FE 24-70mm F2.8 GM II' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3160',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3160',
    width: 6000,
  },
});

if (agentPreviewCompareRequestSchema.safeParse({ requestId: 'compare-1', unknown: true }).success) {
  throw new Error('agent.preview.compare request schema accepted an unknown field.');
}
if (agentPreviewCompareRequestSchema.safeParse({ longEdgePx: 4096, requestId: 'compare-1' }).success) {
  throw new Error('agent.preview.compare request schema accepted an out-of-range preview size.');
}

const state = getAgentReadOnlyState({ requestId: 'state-compare-1' });
const snapshot = z
  .object({
    snapshot: z
      .object({
        clipping: z.object({ highlightsPercent: z.number(), shadowsPercent: z.number() }).passthrough(),
        graphRevision: z.string().min(1),
        histogramSummary: z.array(z.object({ channel: z.string().min(1) }).passthrough()).min(1),
        initialPreview: z.object({ recipeHash: z.string().min(1) }).passthrough(),
        metadataSummary: z.array(z.object({ key: z.string().min(1) }).passthrough()).min(1),
      })
      .passthrough(),
  })
  .passthrough()
  .parse(state).snapshot;

const compare = renderAgentPreviewCompare({
  beforeGraphRevision: 'history_0',
  beforeRecipeHash: 'recipe:before-agent-preview-compare',
  expectedRecipeHash: snapshot.initialPreview.recipeHash,
  longEdgePx: 1536,
  quality: 0.86,
  requestId: 'compare-1',
});
const parsedCompare = agentPreviewCompareResponseSchema.parse(compare);
const [beforeArtifact, currentArtifact] = parsedCompare.compare.artifacts;
if (parsedCompare.staleRecipeHash || parsedCompare.toolName !== AGENT_PREVIEW_COMPARE_TOOL_NAME) {
  throw new Error('agent.preview.compare returned stale or incorrect tool metadata.');
}
if (
  beforeArtifact.role !== 'before' ||
  currentArtifact.role !== 'current' ||
  beforeArtifact.graphRevision !== 'history_0' ||
  currentArtifact.graphRevision !== snapshot.graphRevision
) {
  throw new Error('agent.preview.compare did not preserve before/current graph lineage.');
}
if (
  beforeArtifact.preview.longEdgePx !== 1536 ||
  currentArtifact.preview.longEdgePx !== 1536 ||
  beforeArtifact.preview.quality !== 0.86 ||
  currentArtifact.preview.quality !== 0.86 ||
  beforeArtifact.preview.mediaType !== 'image/jpeg' ||
  currentArtifact.preview.mediaType !== 'image/jpeg'
) {
  throw new Error('agent.preview.compare did not use the medium JPEG preview contract.');
}
if (
  beforeArtifact.preview.includesOriginalRaw ||
  currentArtifact.preview.includesOriginalRaw ||
  beforeArtifact.preview.lifecycle.persisted ||
  currentArtifact.preview.lifecycle.persisted
) {
  throw new Error('agent.preview.compare must not expose originals or persisted preview artifacts.');
}
if (
  beforeArtifact.preview.cacheKey === currentArtifact.preview.cacheKey ||
  beforeArtifact.contentHash === currentArtifact.contentHash ||
  beforeArtifact.preview.renderHash === currentArtifact.preview.renderHash
) {
  throw new Error('agent.preview.compare did not generate distinct before/current artifact identities.');
}
if (
  parsedCompare.compare.lineage.beforeRecipeHash !== 'recipe:before-agent-preview-compare' ||
  parsedCompare.compare.lineage.currentRecipeHash !== snapshot.initialPreview.recipeHash ||
  parsedCompare.compare.lineage.staleRecipeHash
) {
  throw new Error('agent.preview.compare did not return expected recipe lineage.');
}
if (
  parsedCompare.compare.color.workingSpace !== 'rawengine-scene-linear' ||
  parsedCompare.compare.color.previewTransform !== 'editor-preview-to-srgb-jpeg' ||
  parsedCompare.compare.scopeSummary.histogramChannels.length !== snapshot.histogramSummary.length ||
  !parsedCompare.compare.scopeSummary.metadataKeys.includes('ISO')
) {
  throw new Error('agent.preview.compare did not include reviewable color/scope metadata.');
}

const editorState = useEditorStore.getState();
if (editorState.historyIndex !== 1 || editorState.adjustments.exposure !== 0.25) {
  throw new Error('agent.preview.compare mutated editor state.');
}

const staleCompare = renderAgentPreviewCompare({
  expectedRecipeHash: 'recipe:stale',
  requestId: 'compare-stale',
});
if (!staleCompare.staleRecipeHash || !staleCompare.compare.lineage.staleRecipeHash) {
  throw new Error('agent.preview.compare did not flag stale expected recipe hashes.');
}

const catalog = buildRawEngineAppServerRouteCatalog();
const route = catalog.find((candidate) => candidate.commandName === AGENT_PREVIEW_COMPARE_TOOL_NAME);
if (
  route === undefined ||
  route.family !== 'agent' ||
  !route.modes.includes(RawEngineAppServerRouteMode.Read) ||
  !route.runtimeCheckScripts.includes('check:agent-preview-compare-loop')
) {
  throw new Error('agent.preview.compare is missing from the app-server route catalog.');
}

const dispatch = dispatchResultSchema.parse(
  await handleRawEngineAppServerHostRequestAsync({
    arguments: {
      beforeGraphRevision: 'history_0',
      beforeRecipeHash: 'recipe:before-agent-preview-compare',
      expectedRecipeHash: snapshot.initialPreview.recipeHash,
      requestId: 'compare-dispatch',
    },
    requestId: 'dispatch-compare-1',
    runtimeToolName: AGENT_PREVIEW_COMPARE_TOOL_NAME,
    toolName: 'rawengine.host.dispatch_tool',
  }),
);
if (dispatch.result.compare.artifacts[0].role !== 'before' || dispatch.result.compare.artifacts[1].role !== 'current') {
  throw new Error('agent.preview.compare dispatch did not return ordered before/current artifacts.');
}

const stateRoute = catalog.find((candidate) => candidate.commandName === AGENT_STATE_GET_TOOL_NAME);
if (stateRoute === undefined || stateRoute.family !== 'agent') {
  throw new Error('agent state route disappeared while adding preview compare.');
}

console.log('agent preview compare loop ok');
