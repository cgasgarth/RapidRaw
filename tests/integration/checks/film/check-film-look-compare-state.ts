#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { INITIAL_ADJUSTMENTS, normalizeLoadedAdjustments } from '../../../../src/utils/adjustments.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../../src/utils/film-look/filmLookRegistry.ts';

const filmLookStateSchema = z.object({
  filmLookId: z.string().min(1).nullable(),
  filmLookStrength: z.number().int().min(0).max(100),
});

const proofLook = FILM_LOOK_BROWSER_ITEMS.find((look) => look.id === 'film_look.generic.warm_print.v1');
if (proofLook === undefined) {
  throw new Error('Missing proof film look.');
}

filmLookStateSchema.parse({
  filmLookId: INITIAL_ADJUSTMENTS.filmLookId,
  filmLookStrength: INITIAL_ADJUSTMENTS.filmLookStrength,
});

const normalized = normalizeLoadedAdjustments({
  filmLookId: proofLook.id,
  filmLookStrength: 65,
});
const normalizedState = filmLookStateSchema.parse({
  filmLookId: normalized.filmLookId,
  filmLookStrength: normalized.filmLookStrength,
});
if (normalizedState.filmLookId !== proofLook.id || normalizedState.filmLookStrength !== 65) {
  throw new Error('Film look state did not survive adjustment normalization.');
}

const effectsSource = readFileSync('src/components/adjustments/Effects.tsx', 'utf8');
const browserSource = readFileSync('src/components/adjustments/FilmLookBrowser.tsx', 'utf8');
const adjustmentSource = readFileSync('src/utils/adjustments.ts', 'utf8');

for (const [sourceName, source, markers] of [
  [
    'Effects.tsx',
    effectsSource,
    ['filmLookId: look.id', 'filmLookStrength: strength', 'activeLookId={adjustments.filmLookId}'],
  ],
  [
    'FilmLookBrowser.tsx',
    browserSource,
    [
      'data-testid="film-look-active-state"',
      'data-testid="film-look-active-render-preview"',
      'data-testid="film-look-compare-render-preview"',
      'data-color-pipeline-operation-domain="acescg_linear_v1"',
      'data-output-proof="filmLook.applyAbCandidate"',
      'getFilmLookComparePreviewStyle',
      'data-preview-support={look.runtimeSupport}',
    ],
  ],
  ['adjustments.ts', adjustmentSource, ['filmLookId: string | null', 'filmLookStrength: number']],
] satisfies Array<[string, string, Array<string>]>) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${sourceName} missing film compare state marker: ${marker}`);
    }
  }
}

console.log('film look compare state ok');
