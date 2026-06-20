#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/adjustments/FilmLookBrowser.tsx', 'utf8');

for (const marker of [
  'FILM_LOOK_STRENGTH_PRESETS = [25, 50, 75, 100]',
  'film-look-strength-presets',
  'film-look-strength-preset-${presetStrength}',
  'film-look-strength-reset-default',
  'resetSelectedLookStrength',
  'strengthPreset',
  'strengthResetDefault',
  'handleStrengthChange(presetStrength)',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Film Look strength preset UI missing marker: ${marker}`);
  }
}

console.log('film look strength presets ok (4 presets)');
