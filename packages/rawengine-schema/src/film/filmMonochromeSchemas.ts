import { z } from 'zod';
import { filmCharacteristicCurveV1Schema } from './filmCharacteristicCurveSchemas.js';

const rgb = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]);
export const filmMonochromeFilterV1Schema = z
  .object({
    id: z.enum(['none', 'yellow', 'orange', 'red', 'green', 'custom']),
    gainsRgb: rgb,
    filterFactorStops: z.number().finite().min(-8).max(8),
  })
  .strict();
export const filmMonochromePaperToneV1Schema = z
  .object({
    blackAp1: rgb,
    whiteAp1: rgb,
    paperWhiteXy: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]),
    blackDensity: z.number().finite().min(0).max(4),
    amount: z.number().finite().min(0).max(1),
  })
  .strict();
export const filmMonochromeResponseV1Schema = z
  .object({
    model: z.literal('rgb_tristimulus_monochrome_v1'),
    sensitivityRgb: rgb,
    calibrationIlluminant: z.string().trim().min(1),
    limitationStatement: z.string().trim().min(1),
    defaultFilter: filmMonochromeFilterV1Schema,
    characteristicCurve: filmCharacteristicCurveV1Schema,
    paperTone: filmMonochromePaperToneV1Schema.optional(),
  })
  .strict();
export type FilmMonochromeResponseV1 = z.infer<typeof filmMonochromeResponseV1Schema>;

export const normalizeFilmMonochromeFilter = (
  filter: FilmMonochromeFilterV1SchemaInput,
): FilmMonochromeFilterV1SchemaOutput => {
  const parsed = filmMonochromeFilterV1Schema.parse(filter);
  const norm = Math.hypot(...parsed.gainsRgb);
  if (!(norm > Number.EPSILON)) throw new Error('film_monochrome_invalid_filter');
  return {
    ...parsed,
    gainsRgb: parsed.gainsRgb.map((value) => value / norm) as FilmMonochromeResponseV1['defaultFilter']['gainsRgb'],
  };
};
type FilmMonochromeFilterV1SchemaInput = z.input<typeof filmMonochromeFilterV1Schema>;
type FilmMonochromeFilterV1SchemaOutput = z.output<typeof filmMonochromeFilterV1Schema>;
