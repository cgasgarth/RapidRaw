#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const appNavigationSource = readFileSync('src/hooks/app/useAppNavigation.ts', 'utf8');
const tauriListenersSource = readFileSync('src/hooks/app/useTauriListeners.ts', 'utf8');
const filmstripSource = readFileSync('src/components/panel/Filmstrip.tsx', 'utf8');
const bottomBarSource = readFileSync('src/components/panel/BottomBar.tsx', 'utf8');

const requiredMarkers = [
  [appNavigationSource, 'requestThumbnails([path])'],
  [tauriListenersSource, 'thumbnailUrl: pendingThumbs[selectedImage.path] ?? state.selectedImage.thumbnailUrl'],
  [filmstripSource, 'resolveFilmstripThumbnailUrl'],
  [filmstripSource, 'selectedImageThumbnailUrl?: string | undefined;'],
  [bottomBarSource, 'selectedImageThumbnailUrl={selectedImage?.thumbnailUrl}'],
] as const;

const missingMarkers = requiredMarkers
  .filter(([source, marker]) => !source.includes(marker))
  .map(([, marker]) => marker);

if (missingMarkers.length > 0) {
  console.error('filmstrip opened JPEG thumbnail check failed');
  for (const marker of missingMarkers) console.error(`- missing marker: ${marker}`);
  process.exit(1);
}

console.log('filmstrip opened JPEG thumbnail ok');
