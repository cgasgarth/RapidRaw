#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { shouldQueueThumbnailPath } from '../../../src/hooks/useThumbnails.ts';
import { useProcessStore } from '../../../src/store/useProcessStore.ts';

const imageProcessingSource = readFileSync('src/hooks/useImageProcessing.ts', 'utf8');

const requiredMarkers = [
  'useProcessStore.getState().invalidateThumbnails([selectedImage.path])',
  'useProcessStore.getState().invalidateThumbnails(otherPaths)',
] as const;

const missingMarkers = requiredMarkers.filter((marker) => !imageProcessingSource.includes(marker));
if (missingMarkers.length > 0) {
  console.error('filmstrip edit thumbnail refresh check failed');
  for (const marker of missingMarkers) console.error(`- missing marker: ${marker}`);
  process.exit(1);
}

useProcessStore.setState({
  thumbnails: { '/photos/a.ARW': 'blob:stale-a' },
  thumbnailSmartPreviews: {
    '/photos/a.ARW': {
      colorProfile: 'sRGB',
      height: 100,
      source: 'smartPreview',
      sourceAvailable: true,
      sourceRevision: 'edited-revision',
      stale: false,
      width: 150,
    },
  },
});

useProcessStore.getState().invalidateThumbnails(['/photos/a.ARW']);

const state = useProcessStore.getState();
if (state.thumbnails['/photos/a.ARW'] !== undefined || state.thumbnailSmartPreviews['/photos/a.ARW'] !== undefined) {
  throw new Error('Expected edited image thumbnail state to be invalidated.');
}

const generated = new Set(['/photos/a.ARW']);
const pending = new Set<string>();

if (!shouldQueueThumbnailPath('/photos/a.ARW', state.thumbnails, generated, pending)) {
  throw new Error('Expected invalidated generated path to be queued again.');
}

if (generated.has('/photos/a.ARW')) {
  throw new Error('Expected stale generated marker to be cleared before requeue.');
}

pending.add('/photos/a.ARW');
if (shouldQueueThumbnailPath('/photos/a.ARW', state.thumbnails, generated, pending)) {
  throw new Error('Expected pending invalidated path not to be queued twice.');
}

console.log('filmstrip edit thumbnail refresh ok');
