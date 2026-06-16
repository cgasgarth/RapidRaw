import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  FILM_LOOK_BROWSER_ITEMS,
  getFilmLookAdjustmentSummaries,
  scaleFilmLookAdjustmentPatch,
} from '../src/utils/filmLookBrowser.ts';

const fixtureUrl = new URL('../fixtures/film-simulation/film-look-fixture-outputs.json', import.meta.url);
const browserSourceUrl = new URL('../src/components/adjustments/FilmLookBrowser.tsx', import.meta.url);
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
for (const marker of ['showFavoritesOnly', 'favoriteLookCount', 'visibleGroups', 'FILM_LOOK_FAVORITES_STORAGE_KEY']) {
  if (!browserSource.includes(marker)) {
    throw new Error(`Film look browser is missing UI marker: ${marker}`);
  }
}

console.log('Film look fixture outputs are current.');
