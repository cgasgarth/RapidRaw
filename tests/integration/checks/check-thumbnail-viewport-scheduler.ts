import { readFile } from 'node:fs/promises';

const grid = await readFile('src/components/panel/library/LibraryGrid.tsx', 'utf8');
const hook = await readFile('src/hooks/library/useThumbnails.ts', 'utf8');

if (!grid.includes('onRowsRendered={(visibleRows, allRows)')) throw new Error('grid does not report viewport ranges');
if (grid.includes('requestQueueRef') || grid.includes('requestTimeoutRef'))
  throw new Error('per-cell request queue remains');
if (hook.includes('Math.random') || hook.includes('150') || hook.includes('300'))
  throw new Error('legacy shuffled debounce remains');
if (!hook.includes('ThumbnailDemandScheduler')) throw new Error('library session does not own scheduler');

console.log('thumbnail viewport scheduler integration contract: ok');
