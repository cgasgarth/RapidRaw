import { expect, test } from 'bun:test';

import {
  buildFilmLookAppliedAdjustmentPatch,
  getFilmLookAdjustmentSummaries,
} from '../../../src/utils/film-look/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';

test('film look adjustment patches carry halation and grain roughness runtime controls', () => {
  const monoSilver = FILM_LOOK_BROWSER_ITEMS.find((look) => look.id === 'film_look.generic.mono_silver.v1');
  const punchColor = FILM_LOOK_BROWSER_ITEMS.find((look) => look.id === 'film_look.generic.punch_color.v1');

  expect(monoSilver).toBeDefined();
  expect(punchColor).toBeDefined();

  expect(buildFilmLookAppliedAdjustmentPatch(monoSilver!, 100)).toMatchObject({
    grainAmount: 22,
    grainRoughness: 64,
    grainSize: 42,
  });
  expect(buildFilmLookAppliedAdjustmentPatch(punchColor!, 100)).toMatchObject({
    glowAmount: 8,
    halationAmount: 18,
  });

  expect(getFilmLookAdjustmentSummaries(monoSilver!)).toEqual(
    expect.arrayContaining([
      { label: 'Grain', value: 22 },
      { label: 'Grain Roughness', value: 64 },
      { label: 'Grain Size', value: 42 },
    ]),
  );
  expect(getFilmLookAdjustmentSummaries(punchColor!)).toEqual(
    expect.arrayContaining([
      { label: 'Glow', value: 8 },
      { label: 'Halation', value: 18 },
    ]),
  );
});
