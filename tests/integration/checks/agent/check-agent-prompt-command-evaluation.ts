#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import {
  agentPromptCommandFixtures,
  evaluateAgentPromptCommandFixture,
} from '../../../../src/utils/agent/planning/agentPromptCommandEvaluation.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3123.ARW';

const resetStores = (fixtureId: string): void => {
  useLibraryStore.getState().setLibrary({
    activeAlbumId: `album_${fixtureId}`,
    albumTree: [{ id: `album_${fixtureId}`, images: [selectedPath], name: 'Prompt Command Eval', type: 'album' }],
    currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
    filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
    folderTrees: [],
    imageList: [
      {
        exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
        is_edited: false,
        is_virtual_copy: false,
        modified: 1_781_928_123,
        path: selectedPath,
        rating: 4,
        tags: ['agent-prompt-command-evaluation'],
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
    finalPreviewUrl: `blob:rawengine-${fixtureId}-before`,
    hasRenderedFirstFrame: true,
    history: [INITIAL_ADJUSTMENTS],
    historyIndex: 0,
    selectedImage: {
      exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
      height: 4000,
      isRaw: true,
      isReady: true,
      originalUrl: `blob:rawengine-original-${fixtureId}`,
      path: selectedPath,
      thumbnailUrl: `blob:rawengine-thumb-${fixtureId}`,
      width: 6000,
    },
  });
};

const evaluations = [];

for (const fixture of agentPromptCommandFixtures) {
  resetStores(fixture.id);
  evaluations.push(await evaluateAgentPromptCommandFixture(fixture));
}

const recipeKinds = new Set(evaluations.map((evaluation) => evaluation.recipeKind));
const selectedRanges = new Set(evaluations.map((evaluation) => evaluation.selectedHslRange));

if (
  recipeKinds.size !== agentPromptCommandFixtures.length ||
  selectedRanges.size !== agentPromptCommandFixtures.length
) {
  throw new Error('Prompt command evaluation fixtures must cover distinct recipe and selective color outcomes.');
}

if (evaluations.some((evaluation) => evaluation.changedPixelCount < 4)) {
  throw new Error('Prompt command evaluation must prove visible runtime output for every fixture.');
}

console.log(`agent prompt command evaluation ok (${evaluations.length} fixtures)`);
