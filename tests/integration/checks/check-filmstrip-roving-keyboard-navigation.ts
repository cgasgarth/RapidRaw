#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const filmstripSource = readFileSync('src/components/panel/Filmstrip.tsx', 'utf8');
const visualSmokeAssertionsSource = readFileSync('scripts/lib/proofs/visual-smoke/scenario-assertions.ts', 'utf8');

const requiredFilmstripMarkers = [
  'activeIndex === columnIndex ? 0 : -1',
  'role="listbox"',
  'role="option"',
  "event.key === 'ArrowLeft'",
  "event.key === 'ArrowRight'",
  "event.key === 'Home'",
  "event.key === 'End'",
  'data.onImageSelect?.(nextImage.path, event)',
  'performSafeScroll(nextIndex, true)',
  'focusThumbnail(nextImage.path)',
  'data-filmstrip-layout="navigator"',
  'data-filmstrip-state={thumbnailState}',
  'data-testid="filmstrip-metadata-rail"',
  'data-testid="filmstrip-current-marker"',
  'motion-reduce:transition-none',
] as const;

const requiredVisualProofMarkers = [
  '[data-testid="filmstrip-thumbnail"][tabindex="0"]',
  "page.keyboard.press('ArrowRight')",
  "data-active-filename') === 'filmstrip-context-selected.NEF'",
  'Filmstrip roving keyboard state mismatch',
  'Filmstrip navigator geometry/state contract mismatch',
] as const;

const missingMarkers = [
  ...requiredFilmstripMarkers
    .filter((marker) => !filmstripSource.includes(marker))
    .map((marker) => `Filmstrip.tsx: ${marker}`),
  ...requiredVisualProofMarkers
    .filter((marker) => !visualSmokeAssertionsSource.includes(marker))
    .map((marker) => `scenario-assertions.ts: ${marker}`),
];

if (missingMarkers.length > 0) {
  console.error('filmstrip roving keyboard navigation check failed');
  for (const marker of missingMarkers) console.error(`- missing marker: ${marker}`);
  process.exit(1);
}

console.log('filmstrip roving keyboard navigation ok');
