import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildFilmLookAppliedAdjustmentPatch,
  buildFilmLookPresetDraft,
  getFilmLookAdjustmentSummaries,
  scaleFilmLookAdjustmentPatch,
} from '../../../src/utils/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/filmLookRegistry.ts';

const fixtureUrl = new URL('../../../fixtures/film-simulation/film-look-fixture-outputs.json', import.meta.url);
const browserSourceUrl = new URL('../../../src/components/adjustments/FilmLookBrowser.tsx', import.meta.url);
const registrySourceUrl = new URL('../../../src/utils/filmLookRegistry.ts', import.meta.url);
const utilsSourceUrl = new URL('../../../src/utils/filmLookBrowser.ts', import.meta.url);
const updateFixture = process.argv.includes('--update');

const getAdjustmentFingerprint = (adjustmentSummaries) =>
  createHash('sha256').update(JSON.stringify(adjustmentSummaries)).digest('hex');

const buildFixture = () => ({
  fixtureInput: {
    colorSpace: 'adjustment-domain',
    kind: 'synthetic-neutral-adjustment-state',
    note: 'Deterministic fixture for built-in Film Looks. The output captures the adjustment-domain deltas applied by each look, not a rendered image.',
  },
  generatedFrom: 'src/utils/filmLookBrowser.ts',
  outputs: FILM_LOOK_BROWSER_ITEMS.map((look) => {
    const adjustmentSummaries = getFilmLookAdjustmentSummaries(look);

    return {
      adjustmentFingerprint: getAdjustmentFingerprint(adjustmentSummaries),
      adjustmentSummaries,
      category: look.category,
      description: look.description,
      displayName: look.displayName,
      id: look.id,
      provenance: look.provenance,
      runtimeSupport: look.runtimeSupport,
      strengthDefault: look.strengthDefault,
      strengthPreviews: {
        appliedFull: buildFilmLookAppliedAdjustmentPatch(look, 100),
        default: scaleFilmLookAdjustmentPatch(look, look.strengthDefault),
        half: scaleFilmLookAdjustmentPatch(look, 50),
        full: scaleFilmLookAdjustmentPatch(look, 100),
      },
      presetDrafts: {
        default: buildFilmLookPresetDraft(look, look.strengthDefault),
        half: buildFilmLookPresetDraft(look, 50),
        full: buildFilmLookPresetDraft(look, 100),
      },
    };
  }),
  version: 1,
});

const expectedFixture = `${JSON.stringify(buildFixture(), null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(fixtureUrl.pathname), { recursive: true });
  await writeFile(fixtureUrl, expectedFixture);
  process.exit(0);
}

let currentFixture;

try {
  currentFixture = await readFile(fixtureUrl, 'utf8');
} catch (error) {
  throw new Error(`Film look fixture output is missing. Run bun run check:film-fixtures:update. Cause: ${error}`);
}

if (currentFixture !== expectedFixture) {
  throw new Error('Film look fixture outputs are stale. Run bun run check:film-fixtures:update and review the diff.');
}

const browserSource = await readFile(browserSourceUrl, 'utf8');
for (const marker of [
  'showFavoritesOnly',
  'favoriteLookCount',
  'visibleGroups',
  'FILM_LOOK_FAVORITES_STORAGE_KEY',
  'getFilmLookSwatchStyle',
  'searchQuery',
  'adjustments.effects.filmLookBrowser.search',
  'activeCategory',
  'categoryTabs',
  'adjustments.effects.filmLookBrowser.categoryFilter',
  'getFilmLookSearchText',
  'look.provenance.legalNote',
  'handleClearComparisonLooks',
  'adjustments.effects.filmLookBrowser.compareClearAll',
  'film-look-compare-clear-all',
  'handleSwapComparisonLooks',
  'adjustments.effects.filmLookBrowser.compareSwap',
  'film-look-provenance-inspector',
  'film-look-provenance-fields',
  'film-look-adjustment-summary',
  'adjustments.effects.filmLookBrowser.provenanceTitle',
  'formatFilmLookToken',
]) {
  if (!browserSource.includes(marker)) {
    throw new Error(`Film look browser is missing UI marker: ${marker}`);
  }
}

const visualSmokeSourceUrl = new URL('../../../src/validation/visual/VisualSmokeApp.tsx', import.meta.url);
const visualSmokeSource = await readFile(visualSmokeSourceUrl, 'utf8');
for (const marker of ['FilmLookVisualSmoke', 'film-look-browser', 'film-look-adjustment-proof']) {
  if (!visualSmokeSource.includes(marker)) {
    throw new Error(`Visual smoke app is missing film look marker: ${marker}`);
  }
}

const registrySource = await readFile(registrySourceUrl, 'utf8');
const utilsSource = await readFile(utilsSourceUrl, 'utf8');
const prohibitedClaims =
  /\b(?:adobe|capture one|dehancer|exact|identical|lightroom|mastin|manufacturer[ -]?approved|negative lab pro|nlp|official|rni|vsco)\b/iu;
const stockReferenceNames =
  /\b(?:ektachrome|ektar|fujifilm|gold|hp5|ilford|kodak|portra|provia|superia|t-max|tri-x|velvia)\b/iu;

for (const look of FILM_LOOK_BROWSER_ITEMS) {
  const claimText = [
    look.id,
    look.displayName,
    look.description,
    look.category,
    look.provenance.claimLevel,
    look.provenance.legalNamingStatus,
    look.provenance.measurementSource,
  ].join(' ');

  if (prohibitedClaims.test(claimText)) {
    throw new Error(`${look.id}: film look contains prohibited official, competitor, or exact-match claim`);
  }

  if (
    look.provenance.claimLevel === 'generic_engineered' &&
    (look.provenance.legalNamingStatus !== 'generic_safe_name' ||
      look.provenance.measurementSource !== 'generic_engineered_starting_point' ||
      stockReferenceNames.test(claimText))
  ) {
    throw new Error(`${look.id}: built-in film look must use generic-safe provenance`);
  }

  if (
    look.provenance.claimLevel === 'stock_family_reference_metadata' &&
    (look.provenance.legalNamingStatus !== 'descriptive_stock_family' ||
      look.provenance.measurementSource !== 'research_reference_metadata_only' ||
      !/\binspired\b/iu.test(look.displayName))
  ) {
    throw new Error(`${look.id}: stock-reference film look must disclose inspired stock metadata`);
  }

  if (!/\bnot (?:measured|official)\b/iu.test(look.provenance.legalNote)) {
    throw new Error(`${look.id}: built-in film look legal note must disclose unmeasured or unofficial status`);
  }
}

for (const marker of [
  'GENERIC_FILM_LOOK_PROVENANCE',
  'STOCK_REFERENCE_FILM_LOOK_PROVENANCE',
  'FILM_LOOK_BROWSER_ITEMS',
]) {
  if (!registrySource.includes(marker)) {
    throw new Error(`Film look registry is missing catalog marker: ${marker}`);
  }
}

for (const marker of [
  'buildFilmLookAppliedAdjustmentPatch',
  'buildFilmLookPresetDraft',
  'formatFilmLookPresetName',
  'resetFilmLookControlledAdjustments',
  'scaleFilmLookAdjustmentPatch',
]) {
  if (!utilsSource.includes(marker)) {
    throw new Error(`Film look utilities are missing preset parity marker: ${marker}`);
  }
}

const effectsSourceUrl = new URL('../../../src/components/adjustments/Effects.tsx', import.meta.url);
const effectsSource = await readFile(effectsSourceUrl, 'utf8');
for (const marker of [
  'buildFilmLookPresetDraft',
  'Invokes.SaveCommunityPreset',
  'Invokes.HandleExportPresetsToFile',
  'filmLookPresetStatus',
  'film-look-preset-status',
]) {
  if (!effectsSource.includes(marker)) {
    throw new Error(`Effects panel is missing film preset export marker: ${marker}`);
  }
}

console.log('Film look fixture outputs are current.');
