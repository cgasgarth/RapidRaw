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

test('warm print scales through the governed target values at 25, 65, and 100 percent', () => {
  const warmPrint = FILM_LOOK_BROWSER_ITEMS.find((look) => look.id === 'film_look.generic.warm_print.v1');

  expect(warmPrint).toBeDefined();

  expect(buildFilmLookAppliedAdjustmentPatch(warmPrint!, 25)).toEqual({
    blacks: -1,
    contrast: 3,
    glowAmount: 0,
    grainAmount: 3,
    grainRoughness: 52,
    grainSize: 27,
    halationAmount: 2,
    highlights: -3,
    saturation: 1,
    shadows: 1,
    temperature: 2,
  });
  expect(buildFilmLookAppliedAdjustmentPatch(warmPrint!, 65)).toEqual({
    blacks: -3,
    contrast: 7,
    glowAmount: 0,
    grainAmount: 7,
    grainRoughness: 55,
    grainSize: 30,
    halationAmount: 5,
    highlights: -8,
    saturation: 3,
    shadows: 3,
    temperature: 5,
  });
  expect(buildFilmLookAppliedAdjustmentPatch(warmPrint!, 100)).toEqual({
    blacks: -4,
    contrast: 10,
    glowAmount: 0,
    grainAmount: 10,
    grainRoughness: 58,
    grainSize: 32,
    halationAmount: 8,
    highlights: -12,
    saturation: 4,
    shadows: 4,
    temperature: 8,
  });
});
