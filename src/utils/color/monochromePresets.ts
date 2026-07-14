import type { BlackWhiteMixerSettings } from '../adjustments';

export type MonochromePresetId = BlackWhiteMixerSettings['presetId'];

export interface MonochromePreset {
  description: string;
  id: Exclude<MonochromePresetId, 'manual'>;
  label: string;
  process: BlackWhiteMixerSettings['process'];
  weights: BlackWhiteMixerSettings['weights'];
}

const zeroWeights: BlackWhiteMixerSettings['weights'] = {
  aquas: 0,
  blues: 0,
  greens: 0,
  magentas: 0,
  oranges: 0,
  purples: 0,
  reds: 0,
  yellows: 0,
};

const preset = (
  id: MonochromePreset['id'],
  label: string,
  description: string,
  weights: Partial<BlackWhiteMixerSettings['weights']>,
  process: BlackWhiteMixerSettings['process'] = 'continuous_sensitivity_v1',
): MonochromePreset => ({
  id,
  label,
  description,
  process,
  weights: { ...zeroWeights, ...weights },
});

/** Project-owned starting curves; values are EV response handles, not hidden HSL edits. */
export const MONOCHROME_PRESETS: readonly MonochromePreset[] = [
  preset(
    'neutral_panchromatic',
    'Neutral / Panchromatic',
    'Scene-energy neutral conversion.',
    {},
    'neutral_panchromatic_v1',
  ),
  preset('yellow_filter', 'Yellow Filter', 'Gentle warm-filter separation for skies and foliage.', {
    reds: 18,
    oranges: 14,
    yellows: 10,
    blues: -18,
  }),
  preset('orange_filter', 'Orange Filter', 'Moderate warm-filter separation with restrained blue darkening.', {
    reds: 28,
    oranges: 24,
    yellows: 15,
    blues: -30,
    purples: -12,
  }),
  preset('red_filter', 'Red Filter', 'Strong warm-filter starting point; not a spectral simulation.', {
    reds: 42,
    oranges: 30,
    yellows: 18,
    blues: -44,
    purples: -25,
  }),
  preset('green_filter', 'Green Filter', 'Foliage/skin separation with a controlled magenta response.', {
    greens: 28,
    yellows: 14,
    reds: -10,
    magentas: -24,
  }),
  preset('blue_filter', 'Blue Filter', 'Cool-filter starting point with lifted blue/cyan response.', {
    blues: 32,
    aquas: 24,
    oranges: -18,
    reds: -22,
  }),
];

export const findMonochromePreset = (id: MonochromePresetId): MonochromePreset | undefined =>
  MONOCHROME_PRESETS.find((candidate) => candidate.id === id);

export const applyMonochromePreset = (
  settings: BlackWhiteMixerSettings,
  id: MonochromePresetId,
): BlackWhiteMixerSettings => {
  const selected = findMonochromePreset(id);
  if (!selected) return { ...settings, presetId: 'manual' };
  return {
    ...settings,
    enabled: true,
    presetId: selected.id,
    process: selected.process,
    weights: { ...selected.weights },
  };
};
