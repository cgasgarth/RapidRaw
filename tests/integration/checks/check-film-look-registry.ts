#!/usr/bin/env bun

import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { sampleFilmLookCatalogV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/filmLookRegistry.ts';

const prohibitedClaimPattern =
  /\b(?:adobe|capture one|dehancer|exact|identical|lightroom|mastin|manufacturer[ -]?approved|negative lab pro|nlp|official|rni|vsco)\b/iu;
const stockReferenceNamePattern =
  /\b(?:ektachrome|ektar|fujifilm|gold|hp5|ilford|kodak|portra|provia|superia|t-max|tri-x|velvia)\b/iu;

const filmLookRegistryItemSchema = z
  .object({
    adjustmentPatch: z.record(z.string(), z.number()).refine((patch) => Object.keys(patch).length > 0, {
      message: 'Film look registry entries must apply at least one adjustment.',
    }),
    category: z.enum(['black_and_white', 'color_clean', 'color_contrast', 'color_cool', 'color_fade', 'color_warm']),
    description: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    id: z
      .string()
      .trim()
      .regex(/^film_look\.(?:generic|stock_reference)\.[a-z][a-z0-9_]*\.v[0-9]+$/u),
    provenance: z
      .object({
        claimLevel: z.enum(['generic_engineered', 'stock_family_reference_metadata']),
        legalNamingStatus: z.enum(['descriptive_stock_family', 'generic_safe_name']),
        legalNote: z
          .string()
          .trim()
          .min(1)
          .regex(/\bnot (?:measured|official)\b/iu),
        measurementSource: z.enum(['generic_engineered_starting_point', 'research_reference_metadata_only']),
      })
      .strict(),
    runtimeSupport: z.literal('adjustment_patch_preview_export'),
    strengthDefault: z.number().int().min(0).max(100),
  })
  .strict();

const registrySchema = z.array(filmLookRegistryItemSchema).min(1);
const registry = registrySchema.parse(FILM_LOOK_BROWSER_ITEMS);
const catalogLooksById = new Map(sampleFilmLookCatalogV1.looks.map((look) => [look.lookId, look]));
const browserSource = readFileSync('src/components/adjustments/FilmLookBrowser.tsx', 'utf8');

const duplicateValues = (values: Array<string>) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
};

const duplicateIds = duplicateValues(registry.map((look) => look.id));
if (duplicateIds.length > 0) {
  throw new Error(`Film look registry has duplicate IDs: ${duplicateIds.join(', ')}`);
}

const duplicateNames = duplicateValues(registry.map((look) => look.displayName.toLocaleLowerCase('en-US')));
if (duplicateNames.length > 0) {
  throw new Error(`Film look registry has duplicate display names: ${duplicateNames.join(', ')}`);
}

for (const marker of [
  'adjustments.effects.filmLookBrowser.family',
  'film-look-family-field',
  'formatFilmLookToken(selectedLook.category)',
]) {
  if (!browserSource.includes(marker)) {
    throw new Error(`Film look browser missing family inspector marker: ${marker}`);
  }
}

for (const look of registry) {
  const claimText = [
    look.id,
    look.displayName,
    look.description,
    look.category,
    look.provenance.claimLevel,
    look.provenance.legalNamingStatus,
    look.provenance.measurementSource,
  ].join(' ');

  if (prohibitedClaimPattern.test(claimText)) {
    throw new Error(`${look.id}: registry entry includes prohibited official, competitor, or exact-match claim.`);
  }

  if (look.provenance.claimLevel === 'generic_engineered' && stockReferenceNamePattern.test(claimText)) {
    throw new Error(`${look.id}: generic registry entry includes stock-family reference text.`);
  }

  if (
    look.provenance.claimLevel === 'generic_engineered' &&
    (look.provenance.legalNamingStatus !== 'generic_safe_name' ||
      look.provenance.measurementSource !== 'generic_engineered_starting_point')
  ) {
    throw new Error(`${look.id}: generic built-in film look must use generic-safe provenance.`);
  }

  if (
    look.provenance.claimLevel === 'stock_family_reference_metadata' &&
    (look.provenance.legalNamingStatus !== 'descriptive_stock_family' ||
      look.provenance.measurementSource !== 'research_reference_metadata_only' ||
      !/\binspired\b/iu.test(look.displayName))
  ) {
    throw new Error(`${look.id}: stock-reference film look must disclose descriptive inspired metadata.`);
  }

  const catalogLook = catalogLooksById.get(look.id);
  if (catalogLook === undefined) {
    throw new Error(`${look.id}: missing matching schema catalog look.`);
  }

  for (const [field, browserValue, catalogValue] of [
    ['category', look.category, catalogLook.category],
    ['description', look.description, catalogLook.description],
    ['displayName', look.displayName, catalogLook.displayName],
    ['strengthDefault', String(look.strengthDefault), String(catalogLook.strengthDefault)],
  ] satisfies Array<[string, string, string]>) {
    if (browserValue !== catalogValue) {
      throw new Error(`${look.id}: registry ${field} does not match schema catalog.`);
    }
  }

  if (!catalogLook.requiredWarnings.includes('creative_not_exact_emulation')) {
    throw new Error(`${look.id}: schema catalog must keep creative-not-exact warning.`);
  }
}

console.log(`film look registry ok (${registry.length} runtime-safe looks)`);
