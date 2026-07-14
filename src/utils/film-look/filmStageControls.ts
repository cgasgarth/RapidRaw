import {
  type FilmStageControlDescriptorV1,
  type FilmStageIdV1,
  filmStageControlDescriptorListV1Schema,
} from '../../../packages/rawengine-schema/src/index.js';

export const FILM_REFERENCE_STAGE_ID: FilmStageIdV1 = 'reference_luminance_shaper_v1';
export const FILM_REFERENCE_STAGE_DEFAULT_P = 0.35;

/** Renderer-owned controls for the currently supported reference response stage. */
export const getFilmStageControlDescriptors = (
  currentP = FILM_REFERENCE_STAGE_DEFAULT_P,
): FilmStageControlDescriptorV1[] =>
  filmStageControlDescriptorListV1Schema.parse([
    {
      stage: FILM_REFERENCE_STAGE_ID,
      parameterId: 'reference_luminance_shaper_p',
      labelKey: 'adjustments.effects.filmStages.responseP',
      descriptionKey: 'adjustments.effects.filmStages.responsePDescription',
      control: { kind: 'slider', min: 0.0001, max: 4, step: 0.01, fineStep: 0.001, unit: '' },
      defaultValue: FILM_REFERENCE_STAGE_DEFAULT_P,
      currentValue: currentP,
      editability: 'bounded_override',
      evidenceClass: 'engineered',
      calibratedRange: [0.0001, 4],
      resetScope: 'parameter',
      warningCodes: [],
    },
  ]);

export const clampFilmStageControlValue = (descriptor: FilmStageControlDescriptorV1, value: number): number => {
  if (descriptor.control.kind !== 'slider' && descriptor.control.kind !== 'numeric') return value;
  const clamped = Math.min(descriptor.control.max, Math.max(descriptor.control.min, value));
  const step = descriptor.control.step;
  const rounded = Math.round(clamped / step) * step;
  return Number(rounded.toFixed(6));
};

export const isFilmStageControlModified = (descriptor: FilmStageControlDescriptorV1): boolean =>
  descriptor.currentValue !== descriptor.defaultValue;

export const buildFilmStageOperation = (descriptor: FilmStageControlDescriptorV1, value: number) => {
  if (descriptor.stage !== FILM_REFERENCE_STAGE_ID || descriptor.parameterId !== 'reference_luminance_shaper_p')
    throw new Error(`unsupported_film_stage_parameter:${descriptor.parameterId}`);
  return {
    kind: 'set_stage_params' as const,
    stage: FILM_REFERENCE_STAGE_ID,
    patch: { p: clampFilmStageControlValue(descriptor, value) },
  };
};
