#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { applyBasicToneToLiveEditor } from '../../../src/utils/agent/session/agentLiveBasicTone.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3155.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_basic_tone',
  albumTree: [{ id: 'album_agent_basic_tone', images: [selectedPath], name: 'Agent Basic Tone', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [
    {
      children: [],
      hasSubdirs: false,
      imageCount: 1,
      isDir: true,
      name: 'Alaska',
      path: '/Users/cgas/Pictures/Capture One/Alaska',
    },
  ],
  imageList: [
    {
      exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_555,
      path: selectedPath,
      rating: 4,
      tags: ['agent-basic-tone'],
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
  finalPreviewUrl: 'blob:rawengine-preview-before',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  lastBasicToneCommand: null,
  selectedImage: {
    exif: { ISO: '400', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3155',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3155',
    width: 6000,
  },
  uncroppedAdjustedPreviewUrl: null,
});

const result = await applyBasicToneToLiveEditor({
  operationId: 'live_apply_3155',
  requestedAdjustments: {
    ...INITIAL_ADJUSTMENTS,
    blacks: -8,
    brightness: INITIAL_ADJUSTMENTS.brightness,
    clarity: 16,
    contrast: 22,
    exposure: 0.45,
    highlights: -18,
    saturation: 10,
    shadows: 14,
    whites: 7,
  },
  sessionId: 'agent-live-basic-tone-3155',
});

const state = useEditorStore.getState();

if (state.adjustments.exposure !== 0.45 || state.adjustments.contrast !== 22) {
  throw new Error('Agent basic-tone apply did not mutate live editor adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2) {
  throw new Error('Agent basic-tone apply did not push edit history.');
}
if (state.lastBasicToneCommand?.commandId !== result.command.commandId || state.lastBasicToneCommand.dryRun) {
  throw new Error('Agent basic-tone apply did not retain the applied command envelope.');
}
if (state.finalPreviewUrl !== 'blob:rawengine-preview-before') {
  throw new Error('Agent basic-tone apply must preserve the visible preview until the native renderer replaces it.');
}
if (state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('Agent basic-tone apply must invalidate stale uncropped preview output.');
}
if (result.beforePreviewHash === result.afterPreviewHash || result.changedPixelCount < 64) {
  throw new Error('Agent basic-tone renderer proof did not change expected output pixels.');
}
if (
  result.sampledPixelCount !== 64 ||
  result.changedPixelPercent !== 100 ||
  result.meanLuminanceDelta <= 0 ||
  result.maxChannelDelta <= 0
) {
  throw new Error('Agent basic-tone renderer proof must report meaningful preview delta metrics.');
}
if (result.mutation.appliedGraphRevision !== result.appliedGraphRevision) {
  throw new Error('Agent basic-tone result did not preserve mutation graph revision.');
}

console.log('agent basic tone live apply ok (store+history+renderer handoff)');
