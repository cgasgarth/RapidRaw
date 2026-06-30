#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';
import { runAgentCoreEditCommandBundle } from '../../../../src/utils/agent/planning/agentCoreEditCommandBundle.ts';
import { planAgentEditRecipe } from '../../../../src/utils/agent/planning/agentEditRecipePlanner.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3122.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_recipe_planner',
  albumTree: [{ id: 'album_agent_recipe_planner', images: [selectedPath], name: 'Recipe Planner', type: 'album' }],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_122,
      path: selectedPath,
      rating: 4,
      tags: ['agent-recipe-planner'],
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
  finalPreviewUrl: 'blob:rawengine-recipe-before',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  selectedImage: {
    exif: { ISO: '640', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3122',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3122',
    width: 6000,
  },
});

const warmPlan = planAgentEditRecipe('Make this portrait warmer with better skin and more contrast.');
if (warmPlan.recipeKind !== 'warm_portrait_pop' || warmPlan.steps[1]?.kind !== 'selective_color') {
  throw new Error('Recipe planner did not select warm portrait recipe.');
}

const landscapePlan = planAgentEditRecipe('Make this Alaska landscape sky cooler and add detail.');
if (landscapePlan.recipeKind !== 'cool_landscape_detail') {
  throw new Error('Recipe planner did not select cool landscape recipe.');
}

const result = await runAgentCoreEditCommandBundle({
  operationId: 'recipe_planner_3122',
  sessionId: 'agent-recipe-planner-3122',
  steps: warmPlan.steps,
});
const state = useEditorStore.getState();

if (result.changedPixelCount < 4) {
  throw new Error('Recipe planner commands did not prove changed output.');
}
if (state.finalPreviewUrl?.startsWith('rawengine-preview://')) {
  throw new Error('Recipe planner commands must not publish synthetic preview URLs.');
}
if (state.adjustments.hsl.oranges.saturation !== 12 || state.adjustments.contrast !== 20) {
  throw new Error('Recipe planner did not apply typed tone/color commands.');
}

console.log('agent edit recipe planner ok (prompt fixtures+runtime output)');
