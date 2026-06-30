#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { negativeLabStockMetadataCatalogSchema } from '../../../src/schemas/negative-lab/negativeLabStockMetadataCatalogSchemas.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';
import { NEGATIVE_LAB_MEASURED_PROFILE_CATALOG } from '../../../src/utils/negativeLabMeasuredProfileRuntime.ts';
import { NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG } from '../../../src/utils/negativeLabPresetCatalog.ts';

const sourceUrl = new URL('../../../src/data/negativeLabStockMetadataCatalog.json', import.meta.url);
const fixtureUrl = new URL('../../../fixtures/negative-lab/negative-lab-stock-metadata-catalog.json', import.meta.url);
const sourceCatalog = negativeLabStockMetadataCatalogSchema.parse(JSON.parse(await readFile(sourceUrl, 'utf8')));
const fixtureCatalog = negativeLabStockMetadataCatalogSchema.parse(JSON.parse(await readFile(fixtureUrl, 'utf8')));
const genericPresetIds = new Set(NEGATIVE_LAB_BUILT_IN_UI_PRESET_CATALOG.presets.map((preset) => preset.presetId));
const filmLookIds = new Set(FILM_LOOK_BROWSER_ITEMS.map((look) => look.id));
const measuredProfileIds = new Set(NEGATIVE_LAB_MEASURED_PROFILE_CATALOG.profiles.map((profile) => profile.profileId));
const unsafeClaimText =
  /\b(?:adobe|capture one|colorimetric match|dehancer|emulat(?:e|es|ion)|exact(?:ly)?|fuji simulation|identical|lightroom|manufacturer[ -]?approved|mastin|negative lab pro|official|rni|runtime profile|runtime preset|vsco)\b/iu;
const runtimeOnlyKeys = new Set([
  'exportHash',
  'measuredProfileId',
  'params',
  'profileId',
  'renderHash',
  'runtimeProfileId',
]);
const requiredNonClaims = new Set([
  'colorimetric_match',
  'licensed_profile',
  'manufacturer_endorsement',
  'measured_profile',
  'runtime_application',
  'stock_emulation',
]);

if (JSON.stringify(sourceCatalog) !== JSON.stringify(fixtureCatalog)) {
  throw new Error('Negative Lab stock metadata fixture must match source-owned catalog.');
}

const sortedEntryIds = sourceCatalog.entries
  .map((entry) => entry.entryId)
  .toSorted((left, right) => left.localeCompare(right));
if (JSON.stringify(sourceCatalog.entries.map((entry) => entry.entryId)) !== JSON.stringify(sortedEntryIds)) {
  throw new Error('Negative Lab stock metadata catalog must stay sorted by entryId.');
}

for (const entry of sourceCatalog.entries) {
  for (const key of Object.keys(entry)) {
    if (runtimeOnlyKeys.has(key)) {
      throw new Error(`Stock metadata entry contains runtime-only key ${key}: ${entry.entryId}`);
    }
  }

  for (const requiredNonClaim of requiredNonClaims) {
    if (!entry.doesNotProve.includes(requiredNonClaim)) {
      throw new Error(`Stock metadata entry missing required non-claim ${requiredNonClaim}: ${entry.entryId}`);
    }
  }

  if (entry.suggestedGenericPresetId !== null && !genericPresetIds.has(entry.suggestedGenericPresetId)) {
    throw new Error(`Stock metadata entry references unknown generic preset: ${entry.entryId}`);
  }

  if (['cinema_negative', 'slide_reversal'].includes(entry.stockClass) && entry.suggestedGenericPresetId !== null) {
    throw new Error(`Non-Negative-Lab process metadata must not suggest an applyable preset: ${entry.entryId}`);
  }

  if (filmLookIds.has(entry.entryId) || genericPresetIds.has(entry.entryId) || measuredProfileIds.has(entry.entryId)) {
    throw new Error(`Stock metadata entry leaked into a runtime catalog: ${entry.entryId}`);
  }

  const claimText = [
    entry.colorResponseNotes,
    entry.contrastCurveDescriptor,
    entry.displayName,
    entry.grainModelDescriptor,
    entry.sourceReferences.join(' '),
    entry.stockFamilyDescriptor,
  ].join(' ');
  if (unsafeClaimText.test(claimText)) {
    throw new Error(`Stock metadata entry contains unsafe runtime/emulation claim text: ${entry.entryId}`);
  }
}

const classCounts = sourceCatalog.entries.reduce(
  (counts, entry) => counts.set(entry.stockClass, (counts.get(entry.stockClass) ?? 0) + 1),
  new Map(),
);

for (const [stockClass, minimumCount] of [
  ['black_and_white_negative', 4],
  ['cinema_negative', 3],
  ['color_negative', 6],
  ['slide_reversal', 3],
]) {
  if ((classCounts.get(stockClass) ?? 0) < minimumCount) {
    throw new Error(`Stock metadata catalog needs at least ${minimumCount} ${stockClass} entries.`);
  }
}

console.log(`negative lab stock metadata ok (${sourceCatalog.entries.length} metadata-only named references)`);
