#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const filmLookLocale = locale.adjustments?.effects?.filmLookBrowser;
const requiredLocaleKeys = [
  'favoriteCount_one',
  'favoriteCount_other',
  'favorites',
  'lookCount_one',
  'lookCount_other',
];

const missingKeys = requiredLocaleKeys.filter((key) => typeof filmLookLocale?.[key] !== 'string');
if (missingKeys.length > 0) {
  console.error(`Missing Film Look browser locale keys: ${missingKeys.join(', ')}`);
  process.exit(1);
}

const source = readFileSync('src/components/adjustments/FilmLookBrowser.tsx', 'utf8');
for (const marker of [
  'data-testid="film-look-favorites-count"',
  'data-testid="film-look-readiness-summary"',
  'data-testid="film-look-readiness-family"',
  'data-testid="film-look-readiness-claim"',
  'data-testid="film-look-readiness-runtime"',
  'data-preview-export-ready={String(selectedLookRuntimeReady)}',
  'data-claim-level={selectedLook.provenance.claimLevel}',
  'adjustments.effects.filmLookBrowser.favoriteCount',
  'favoriteLookCount',
  'selectedLookRuntimeReady',
]) {
  if (!source.includes(marker)) {
    console.error(`Film Look browser missing favorite count marker: ${marker}`);
    process.exit(1);
  }
}

console.log('film look browser UI ok');
