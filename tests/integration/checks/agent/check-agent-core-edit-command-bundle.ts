#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { runAgentCoreEditCommandBundle } from '../../../../src/utils/agent/planning/agentCoreEditCommandBundle.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3158.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_core_bundle',
  albumTree: [{ id: 'album_agent_core_bundle', images: [selectedPath], name: 'Agent Core Bundle', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_558,
      path: selectedPath,
      rating: 4,
      tags: ['agent-core-command-bundle'],
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
  finalPreviewUrl: 'blob:rawengine-core-before',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3158',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3158',
    width: 6000,
  },
});

const result = await runAgentCoreEditCommandBundle({
  operationId: 'core_bundle_3158',
  sessionId: 'agent-core-command-bundle-3158',
  steps: [
    {
      kind: 'basic_tone',
      payload: {
        ...INITIAL_ADJUSTMENTS,
        blacks: -6,
        brightness: INITIAL_ADJUSTMENTS.brightness,
        clarity: 14,
        contrast: 20,
        exposure: 0.3,
        highlights: -15,
        saturation: 6,
        shadows: 10,
        whites: 5,
      },
    },
    {
      kind: 'selective_color',
      payload: {
        adjustment: { hue: -4, luminance: 5, saturation: 12 },
        rangeKey: 'oranges',
      },
    },
  ],
});

const state = useEditorStore.getState();

if (result.dryRuns.length !== 2 || result.mutations.length !== 2) {
  throw new Error('Agent core command bundle must execute dry-run/apply for both commands.');
}
if (!result.dryRuns.some((dryRun) => dryRun.parameterDiff.some((diff) => diff.path === '/parameters/exposureEv'))) {
  throw new Error('Agent core command bundle must include basic tone exposure diff.');
}
if (
  !result.dryRuns.some((dryRun) => dryRun.parameterDiff.some((diff) => diff.path === '/parameters/orange/saturation'))
) {
  throw new Error('Agent core command bundle must include selective color saturation diff.');
}
if (state.adjustments.exposure !== 0.3 || state.adjustments.hsl.oranges.saturation !== 12) {
  throw new Error('Agent core command bundle did not apply tone and selective color adjustments.');
}
if (state.historyIndex !== 1 || state.history.length !== 2) {
  throw new Error('Agent core command bundle did not commit one history entry.');
}
if (result.changedPixelCount < 4) {
  throw new Error('Agent core command bundle did not prove changed preview output.');
}
if (state.finalPreviewUrl !== 'blob:rawengine-core-before') {
  throw new Error('Agent core command bundle must preserve visible preview until native render completes.');
}
if (state.uncroppedAdjustedPreviewUrl !== null) {
  throw new Error('Agent core command bundle must invalidate stale uncropped preview output.');
}
if (result.mutations.at(-1)?.commandType !== 'toneColor.adjustHsl') {
  throw new Error('Agent core command bundle final mutation must come from final HSL apply.');
}

console.log('agent core edit command bundle ok (tone+selective color runtime)');
