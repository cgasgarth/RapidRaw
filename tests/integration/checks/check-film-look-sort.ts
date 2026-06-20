#!/usr/bin/env bun

import {
  getFilmLookAdjustmentSummaries,
  sortFilmLookBrowserItems,
  type FilmLookSortMode,
} from '../../../src/utils/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/filmLookRegistry.ts';

const assertOrder = (sortMode: FilmLookSortMode, expectedIds: Array<string>) => {
  const sortedIds = sortFilmLookBrowserItems(FILM_LOOK_BROWSER_ITEMS, sortMode)
    .slice(0, expectedIds.length)
    .map((look) => look.id);

  if (sortedIds.join('|') !== expectedIds.join('|')) {
    throw new Error(`${sortMode}: expected ${expectedIds.join(', ')}, got ${sortedIds.join(', ')}`);
  }
};

const catalogIds = FILM_LOOK_BROWSER_ITEMS.map((look) => look.id);
const sortedCatalogIds = sortFilmLookBrowserItems(FILM_LOOK_BROWSER_ITEMS, 'catalog').map((look) => look.id);
if (catalogIds.join('|') !== sortedCatalogIds.join('|')) {
  throw new Error('catalog sort must preserve registry order');
}

const strengthSorted = sortFilmLookBrowserItems(FILM_LOOK_BROWSER_ITEMS, 'strength_desc');
for (let index = 1; index < strengthSorted.length; index += 1) {
  const previous = strengthSorted[index - 1];
  const current = strengthSorted[index];

  if (previous.strengthDefault < current.strengthDefault) {
    throw new Error(`${current.id}: strength sort is not descending`);
  }
}

const controlCountSorted = sortFilmLookBrowserItems(FILM_LOOK_BROWSER_ITEMS, 'adjustment_count_desc');
for (let index = 1; index < controlCountSorted.length; index += 1) {
  const previousCount = getFilmLookAdjustmentSummaries(controlCountSorted[index - 1]).length;
  const currentCount = getFilmLookAdjustmentSummaries(controlCountSorted[index]).length;

  if (previousCount < currentCount) {
    throw new Error(`${controlCountSorted[index].id}: control-count sort is not descending`);
  }
}

assertOrder('name_asc', [
  'film_look.generic.clean_color.v1',
  'film_look.generic.cool_contrast.v1',
  'film_look.stock_reference.gold_200_warmth.v1',
]);

console.log(`film look sort ok (${FILM_LOOK_BROWSER_ITEMS.length} looks)`);
