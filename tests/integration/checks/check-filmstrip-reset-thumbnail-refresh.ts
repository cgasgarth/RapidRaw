#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { useProcessStore } from '../../../src/store/useProcessStore';

const editorActionsSource = readFileSync('src/hooks/editor/useEditorActions.ts', 'utf8');
const filmstripSource = readFileSync('src/components/panel/Filmstrip.tsx', 'utf8');
const processStoreSource = readFileSync('src/store/useProcessStore.ts', 'utf8');

const requiredMarkers = [
  [editorActionsSource, 'invalidateThumbnails(pathsToReset)'],
  [filmstripSource, 'if (!thumbData)'],
  [filmstripSource, 'setLayers([])'],
  [filmstripSource, 'onRequestThumbnails(pathsToRequest)'],
  [processStoreSource, 'invalidateThumbnails: (paths: ReadonlyArray<string>) => void'],
  [processStoreSource, 'const omitPaths = <Value>'],
  [processStoreSource, 'thumbnailSmartPreviews: omitPaths(prev.thumbnailSmartPreviews, pathSet)'],
  [processStoreSource, 'thumbnails: omitPaths(prev.thumbnails, pathSet)'],
] as const;

const missingMarkers = requiredMarkers
  .filter(([source, marker]) => !source.includes(marker))
  .map(([, marker]) => marker);

if (missingMarkers.length > 0) {
  console.error('filmstrip reset thumbnail refresh check failed');
  for (const marker of missingMarkers) console.error(`- missing marker: ${marker}`);
  process.exit(1);
}

useProcessStore.setState({
  thumbnailSmartPreviews: {
    '/photos/a.ARW': {
      colorProfile: 'Display P3',
      height: 100,
      source: 'smartPreview',
      sourceAvailable: true,
      sourceRevision: 'edited-revision',
      stale: false,
      width: 150,
    },
    '/photos/b.ARW': {
      colorProfile: 'sRGB',
      height: 100,
      source: 'smartPreview',
      sourceAvailable: true,
      sourceRevision: 'kept-revision',
      stale: false,
      width: 150,
    },
  },
  thumbnails: {
    '/photos/a.ARW': 'blob:edited-a',
    '/photos/b.ARW': 'blob:kept-b',
  },
});

useProcessStore.getState().invalidateThumbnails(['/photos/a.ARW']);

const state = useProcessStore.getState();
if (state.thumbnails['/photos/a.ARW'] !== undefined || state.thumbnailSmartPreviews['/photos/a.ARW'] !== undefined) {
  throw new Error('Expected reset image thumbnail and smart-preview metadata to be invalidated.');
}
if (state.thumbnails['/photos/b.ARW'] !== 'blob:kept-b') {
  throw new Error('Expected unrelated thumbnail cache entry to remain.');
}

console.log('filmstrip reset thumbnail refresh ok');
