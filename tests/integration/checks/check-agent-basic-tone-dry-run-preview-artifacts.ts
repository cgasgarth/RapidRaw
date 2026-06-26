#!/usr/bin/env bun

import { RawStatus, SortDirection } from '../../../src/components/ui/AppProperties.tsx';
import { useEditorStore } from '../../../src/store/useEditorStore.ts';
import { useLibraryStore } from '../../../src/store/useLibraryStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { buildAgentBasicToneDryRunPreviewArtifacts } from '../../../src/utils/agentDryRunPreviewArtifacts.ts';

const selectedPath = '/Users/cgas/Pictures/Capture One/Alaska/DSC_3157.ARW';

useLibraryStore.getState().setLibrary({
  activeAlbumId: 'album_agent_preview_artifacts',
  albumTree: [
    { id: 'album_agent_preview_artifacts', images: [selectedPath], name: 'Preview Artifacts', type: 'album' },
  ],
  currentFolderPath: '/Users/cgas/Pictures/Capture One/Alaska',
  filterCriteria: { colors: [], editedStatus: 'all', rating: 0, rawStatus: RawStatus.RawOnly },
  folderTrees: [],
  imageList: [
    {
      exif: { ISO: '500', LensModel: 'FE 35mm F1.4 GM' },
      is_edited: false,
      is_virtual_copy: false,
      modified: 1_781_928_557,
      path: selectedPath,
      rating: 4,
      tags: ['agent-preview-artifacts'],
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
  finalPreviewUrl: 'blob:rawengine-before-dry-run',
  hasRenderedFirstFrame: true,
  history: [INITIAL_ADJUSTMENTS],
  historyIndex: 0,
  lastBasicToneCommand: null,
  selectedImage: {
    exif: { ISO: '500', LensModel: 'FE 35mm F1.4 GM' },
    height: 4000,
    isRaw: true,
    isReady: true,
    originalUrl: 'blob:rawengine-original-3157',
    path: selectedPath,
    thumbnailUrl: 'blob:rawengine-thumb-3157',
    width: 6000,
  },
});

const result = await buildAgentBasicToneDryRunPreviewArtifacts({
  operationId: 'dry_run_3157',
  requestedAdjustments: {
    ...INITIAL_ADJUSTMENTS,
    blacks: -5,
    brightness: INITIAL_ADJUSTMENTS.brightness,
    clarity: 11,
    contrast: 19,
    exposure: 0.4,
    highlights: -16,
    saturation: 8,
    shadows: 12,
    whites: 5,
  },
  sessionId: 'agent-preview-artifacts-3157',
});

const state = useEditorStore.getState();

if (result.graphRevisionBefore !== 'history_0' || result.graphRevisionAfter !== 'history_0') {
  throw new Error('Agent dry-run preview must not mutate graph revision.');
}
if (state.historyIndex !== 0 || state.adjustments.exposure !== INITIAL_ADJUSTMENTS.exposure) {
  throw new Error('Agent dry-run preview mutated live editor state.');
}
if (result.beforePreviewHash === result.afterPreviewHash || result.changedPixelCount < 5) {
  throw new Error('Agent dry-run preview artifacts did not prove rendered before/after change.');
}
if (result.beforeArtifact.kind !== 'preview' || result.afterArtifact.kind !== 'preview') {
  throw new Error('Agent dry-run before/after artifacts must be preview artifacts.');
}
if (
  result.beforePreview.mediaType !== 'image/jpeg' ||
  result.afterPreview.mediaType !== 'image/jpeg' ||
  result.beforePreview.longEdgePx !== 1536 ||
  result.afterPreview.longEdgePx !== 1536 ||
  result.beforePreview.quality !== 0.86 ||
  result.afterPreview.quality !== 0.86
) {
  throw new Error('Agent dry-run previews must use the standardized medium-preview artifact contract.');
}
if (
  result.beforePreview.previewRef !== result.beforeArtifact.artifactId ||
  result.afterPreview.previewRef !== result.afterArtifact.artifactId ||
  result.beforePreview.purpose !== 'detail_review' ||
  result.afterPreview.purpose !== 'refresh'
) {
  throw new Error('Agent dry-run preview envelopes must bind to before/after tool receipt artifacts.');
}
if (
  result.beforePreview.recipeHash === result.afterPreview.recipeHash ||
  result.beforePreview.renderHash === result.afterPreview.renderHash ||
  result.beforePreview.cacheKey === result.afterPreview.cacheKey
) {
  throw new Error('Agent dry-run preview envelopes must invalidate after tool-proposed edits.');
}
if (
  !result.afterPreview.cachePolicy.invalidatesOn.includes('recipe_hash') ||
  !result.afterPreview.cachePolicy.invalidatesOn.includes('render_settings') ||
  result.afterPreview.lifecycle.persisted ||
  result.afterPreview.includesOriginalRaw
) {
  throw new Error('Agent dry-run preview envelopes must stay ephemeral and recipe/render invalidated.');
}
if (result.beforeArtifact.contentHash !== `sha256:${result.beforePreviewHash}`) {
  throw new Error('Before artifact hash does not match renderer output.');
}
if (result.afterArtifact.contentHash !== `sha256:${result.afterPreviewHash}`) {
  throw new Error('After artifact hash does not match renderer output.');
}
if (result.previewResult.dryRun !== true || result.previewResult.mutates !== false) {
  throw new Error('Agent dry-run preview must preserve non-mutating dry-run result.');
}
if (result.previewResult.sourceGraphRevision !== 'history_0') {
  throw new Error('Agent dry-run preview result must be tied to current graph revision.');
}

console.log('agent basic tone dry-run preview artifacts ok (medium-contract+nonmutating)');
