#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { filmGrainControlsV1Schema } from '../../../packages/rawengine-schema/src/filmGrainProvenance.ts';
import { buildFilmGrainPresetAdjustmentPatch, FILM_GRAIN_UI_PRESETS } from '../../../src/utils/filmGrainControls.ts';

const prohibitedStockClaimPattern =
  /\b(?:ektachrome|ektar|fujifilm|gold|hp5|ilford|kodak|portra|provia|superia|t-max|tri-x|velvia)\b/iu;

const localeSchema = z.object({
  adjustments: z.object({
    effects: z.object({
      grainChromaPlanned: z.string().trim().min(1),
      grainPresets: z.object({
        classic400: z.string().trim().min(1),
        fine100: z.string().trim().min(1),
        push1600: z.string().trim().min(1),
      }),
      grainRendererStatus: z.string().trim().min(1),
    }),
  }),
});

const ids = new Set<string>();
for (const preset of FILM_GRAIN_UI_PRESETS) {
  if (ids.has(preset.id)) {
    throw new Error(`Duplicate film grain UI preset id: ${preset.id}`);
  }
  ids.add(preset.id);

  if (prohibitedStockClaimPattern.test([preset.id, preset.labelKey].join(' '))) {
    throw new Error(`${preset.id}: preset must stay ISO-style and avoid named stock claims`);
  }

  const patch = buildFilmGrainPresetAdjustmentPatch(preset);
  filmGrainControlsV1Schema.parse({
    amount: patch.grainAmount,
    roughness: patch.grainRoughness,
    size: patch.grainSize,
  });
}

const effectsSource = await readFile('src/components/adjustments/Effects.tsx', 'utf8');
for (const marker of [
  'FILM_GRAIN_UI_PRESETS',
  'film-grain-ui-controls',
  'film-grain-preset-shortcuts',
  'film-grain-renderer-status',
  'film-grain-chroma-planned',
]) {
  if (!effectsSource.includes(marker)) {
    throw new Error(`Effects panel is missing film grain UI marker: ${marker}`);
  }
}

for (const locale of ['en', 'de', 'pl', 'zh-CN']) {
  const parsed = localeSchema.parse(JSON.parse(await readFile(`src/i18n/locales/${locale}.json`, 'utf8')));
  const text = JSON.stringify(parsed.adjustments.effects);
  if (prohibitedStockClaimPattern.test(text)) {
    throw new Error(`${locale}: film grain UI text must avoid named stock claims`);
  }
}

console.log(`film grain UI controls ok (${FILM_GRAIN_UI_PRESETS.length} presets)`);
