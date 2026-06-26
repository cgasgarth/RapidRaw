#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { ActiveChannel, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { runAgentBoundedEditPlannerLoop } from '../../../src/utils/agentBoundedEditPlannerLoop.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3159.ARW';
const bins = Array.from({ length: 256 }, (_, index) => (index === 0 || index === 255 ? 10 : 2));

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_planner_loop',
  albumTree: [{ id: 'album_agent_planner_loop', images: [selectedPath], name: 'Planner Loop', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_559,
      path: selectedPath,
      rating: 4,
      tags: ['agent-planner-loop'],
    },
  ],
  imageRatings: { [selectedPath]: 4 },
  libraryActivePath: selectedPath,
  multiSelectedPaths: [selectedPath],
  pinnedFolderTrees: [],
  rootPaths: ['/Users/cgas/Pictures/Capture One'],
  sortCriteria: { key: 'rating', label: 'Rating', order: SortDirection.Descending },
});

useEditorStore.getState().setEditor({
  adjustments: INITIAL_ADJUSTMENTS,
  finalPreviewUrl: 'blob:rawengine-planner-before',
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
    exif: { ISO: '800', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3159',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3159',
    width: 6000,
  },
});

const result = await runAgentBoundedEditPlannerLoop({
  maxSteps: 5,
  operationId: 'planner_loop_3159',
  prompt: 'Make this RAW brighter, warmer, and add contrast without applying until I approve.',
  sessionId: 'agent-planner-loop-3159',
});

const state = useEditorStore.getState();
const stages = result.transcript.map((entry) => entry.stage);

if (result.stopState !== 'approval_ready') {
  throw new Error('Agent planner loop must stop with an approval-ready dry-run.');
}
if (result.transcript.length > 5 || stages.join(',') !== 'inspect,plan,dry_run,observe') {
  throw new Error(`Agent planner loop transcript was not bounded or ordered: ${stages.join(',')}.`);
}
if (result.initialGraphRevision !== 'history_0' || result.finalGraphRevision !== 'history_0') {
  throw new Error('Agent planner loop dry-run must not mutate graph revision.');
}
if (state.historyIndex !== 0 || state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) {
  throw new Error('Agent planner loop mutated live editor state before approval.');
}
if (result.dryRunBeforeHash === result.dryRunAfterHash) {
  throw new Error('Agent planner loop must produce changed before/after dry-run output.');
}
if (result.plannedSteps.length !== 2 || result.plannedSteps[1]?.kind !== 'selective_color') {
  throw new Error('Agent planner loop did not plan the expected tone/color bundle.');
}
if (result.inspected.activeImagePath !== selectedPath || result.inspected.histogramSummary.length === 0) {
  throw new Error('Agent planner loop did not inspect bounded RAW context.');
}
if (
  result.initialPromptContext.prompt !==
    'Make this RAW brighter, warmer, and add contrast without applying until I approve.' ||
  result.initialPromptContext.sessionId !== 'agent-planner-loop-3159' ||
  result.initialPromptContext.modelInput.transport !== 'codex_app_server' ||
  !result.initialPromptContext.modelInput.safetyConstraints.requireTypedTools ||
  !result.initialPromptContext.modelInput.safetyConstraints.requireUserApprovalBeforeApply
) {
  throw new Error('Agent planner loop did not build a bounded app-server initial prompt request.');
}
if (
  result.initialPromptContext.modelInput.activeImagePath !== selectedPath ||
  result.initialPromptContext.modelInput.graphRevision !== 'history_0' ||
  result.initialPromptContext.modelInput.currentAdjustments.length === 0
) {
  throw new Error('Agent initial prompt request did not include selected image, revision, and adjustment context.');
}
if (
  result.inspected.initialPreview.mediaType !== 'image/jpeg' ||
  result.inspected.initialPreview.previewRef === 'blob:rawengine-original-3159'
) {
  throw new Error('Agent planner loop did not attach the safe initial preview context.');
}
if (
  result.initialPromptContext.preview.mediaType !== 'image/jpeg' ||
  result.initialPromptContext.preview.longEdgePx !== 1536 ||
  result.initialPromptContext.preview.quality !== 0.86 ||
  result.initialPromptContext.preview.accessScope !== 'local_private' ||
  result.initialPromptContext.preview.previewRef !== 'blob:rawengine-planner-before'
) {
  throw new Error('Agent initial prompt request did not attach the medium private preview descriptor.');
}
if (
  result.initialPromptContext.modelInput.initialPreview.artifactId !== result.initialPromptContext.preview.artifactId ||
  result.initialPromptContext.modelInput.initialPreview.mediaType !== 'image/jpeg' ||
  result.initialPromptContext.modelInput.initialPreview.longEdgePx !== 1536 ||
  result.initialPromptContext.modelInput.initialPreview.quality !== 0.86 ||
  result.initialPromptContext.modelInput.initialPreview.includesOriginalRaw !== false ||
  result.initialPromptContext.modelInput.initialPreview.width <= 0 ||
  result.initialPromptContext.modelInput.initialPreview.height <= 0
) {
  throw new Error('Agent app-server model input did not carry the initial medium preview attachment.');
}
if (!result.transcript[0]?.detail.includes(result.initialPromptContext.preview.artifactId)) {
  throw new Error('Agent planner loop transcript did not prove the initial preview was part of inspection.');
}

console.log('agent bounded planner loop ok (initial-preview+dry-run)');
