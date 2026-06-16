import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildFilmLookPresetDraft,
  FILM_LOOK_BROWSER_ITEMS,
  getFilmLookAdjustmentSummaries,
  scaleFilmLookAdjustmentPatch,
} from '../src/utils/filmLookBrowser.ts';

const fixtureUrl = new URL('../fixtures/film-simulation/film-look-fixture-outputs.json', import.meta.url);
const browserSourceUrl = new URL('../src/components/adjustments/FilmLookBrowser.tsx', import.meta.url);
const utilsSourceUrl = new URL('../src/utils/filmLookBrowser.ts', import.meta.url);
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
      strengthDefault: look.strengthDefault,
      strengthPreviews: {
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
  'FILM_LOOK_SEARCH_LABEL',
  'activeCategory',
  'categoryTabs',
  'FILM_LOOK_CATEGORY_FILTER_LABEL',
  'handleSwapComparisonLooks',
  'FILM_LOOK_COMPARE_SWAP_LABEL',
]) {
  if (!browserSource.includes(marker)) {
    throw new Error(`Film look browser is missing UI marker: ${marker}`);
  }
}

const visualSmokeSourceUrl = new URL('../src/validation/visual/VisualSmokeApp.tsx', import.meta.url);
const visualSmokeSource = await readFile(visualSmokeSourceUrl, 'utf8');
for (const marker of ['FilmLookVisualSmoke', 'film-look-browser', 'film-look-adjustment-proof']) {
  if (!visualSmokeSource.includes(marker)) {
    throw new Error(`Visual smoke app is missing film look marker: ${marker}`);
  }
}

const utilsSource = await readFile(utilsSourceUrl, 'utf8');
for (const marker of ['buildFilmLookPresetDraft', 'formatFilmLookPresetName', 'scaleFilmLookAdjustmentPatch']) {
  if (!utilsSource.includes(marker)) {
    throw new Error(`Film look utilities are missing preset parity marker: ${marker}`);
  }
}

const effectsSourceUrl = new URL('../src/components/adjustments/Effects.tsx', import.meta.url);
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
