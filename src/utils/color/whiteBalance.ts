import { z } from 'zod';

export const WHITE_BALANCE_CONTRACT = 'rapidraw.white_balance.v1' as const;
export const WHITE_BALANCE_ALGORITHM = 'cat16_ap1_illuminant_v1' as const;

export const whiteBalanceModeSchema = z.enum(['as_shot', 'auto', 'kelvin_tint', 'chromaticity', 'preset']);
export type WhiteBalanceMode = z.infer<typeof whiteBalanceModeSchema>;
export const whiteBalancePresetIdSchema = z.enum(['tungsten', 'daylight', 'flash', 'cloudy', 'shade']);
export type WhiteBalancePresetId = z.infer<typeof whiteBalancePresetIdSchema>;
export const WHITE_BALANCE_PRESETS: ReadonlyArray<{
  id: WhiteBalancePresetId;
  label: string;
  kelvin: number;
  duv: number;
}> = [
  { id: 'tungsten', label: 'Tungsten', kelvin: 2856, duv: 0 },
  { id: 'daylight', label: 'Daylight', kelvin: 5503, duv: 0 },
  { id: 'flash', label: 'Flash', kelvin: 6000, duv: 0 },
  { id: 'cloudy', label: 'Cloudy', kelvin: 6500, duv: 0 },
  { id: 'shade', label: 'Shade', kelvin: 7500, duv: 0 },
];

export const technicalWhiteBalanceSchema = z
  .object({
    contract: z.literal(WHITE_BALANCE_CONTRACT),
    mode: whiteBalanceModeSchema,
    kelvin: z.number().min(1667).max(25000),
    duv: z.number().min(-0.05).max(0.05),
    x: z.number().gt(0).lt(1),
    y: z.number().gt(0).lt(1),
    adaptation: z.literal('cat16_v1'),
    source: z.enum(['as_shot', 'auto', 'picker', 'preset', 'user']),
    confidence: z.number().min(0).max(1).nullable(),
    sampleCount: z.number().int().nonnegative().nullable(),
    inputSemantics: z.enum(['raw_scene_linear', 'rendered_scene_linear_approximation']).default('raw_scene_linear'),
    presetId: whiteBalancePresetIdSchema.nullable().default(null),
    synchronization: z
      .object({
        mode: z.enum(['per_image', 'locked_reference']),
        referenceSourceIdentity: z.string().trim().min(1).nullable(),
      })
      .strict()
      .default({ mode: 'per_image', referenceSourceIdentity: null }),
  })
  .strict()
  .refine(({ x, y }) => x + y < 1, { message: 'Chromaticity x+y must be below one' });

export type TechnicalWhiteBalance = z.infer<typeof technicalWhiteBalanceSchema>;

const multiply = (left: number[][], right: number[][]): number[][] =>
  left.map(
    (row) =>
      right[0]?.map((_, column) => row.reduce((sum, value, i) => sum + value * (right[i]?.[column] ?? 0), 0)) ?? [],
  );

const multiplyVector = (matrix: number[][], vector: readonly number[]): number[] =>
  matrix.map((row) => row.reduce((sum, value, i) => sum + value * (vector[i] ?? 0), 0));

const invert3 = (m: number[][]): number[][] => {
  const [a, b, c] = m[0] ?? [];
  const [d, e, f] = m[1] ?? [];
  const [g, h, i] = m[2] ?? [];
  const determinant =
    (a ?? 0) * ((e ?? 0) * (i ?? 0) - (f ?? 0) * (h ?? 0)) -
    (b ?? 0) * ((d ?? 0) * (i ?? 0) - (f ?? 0) * (g ?? 0)) +
    (c ?? 0) * ((d ?? 0) * (h ?? 0) - (e ?? 0) * (g ?? 0));
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('white_balance_singular_matrix');
  return [
    [
      ((e ?? 0) * (i ?? 0) - (f ?? 0) * (h ?? 0)) / determinant,
      ((c ?? 0) * (h ?? 0) - (b ?? 0) * (i ?? 0)) / determinant,
      ((b ?? 0) * (f ?? 0) - (c ?? 0) * (e ?? 0)) / determinant,
    ],
    [
      ((f ?? 0) * (g ?? 0) - (d ?? 0) * (i ?? 0)) / determinant,
      ((a ?? 0) * (i ?? 0) - (c ?? 0) * (g ?? 0)) / determinant,
      ((c ?? 0) * (d ?? 0) - (a ?? 0) * (f ?? 0)) / determinant,
    ],
    [
      ((d ?? 0) * (h ?? 0) - (e ?? 0) * (g ?? 0)) / determinant,
      ((b ?? 0) * (g ?? 0) - (a ?? 0) * (h ?? 0)) / determinant,
      ((a ?? 0) * (e ?? 0) - (b ?? 0) * (d ?? 0)) / determinant,
    ],
  ];
};

const CAT16 = [
  [0.401288, 0.650173, -0.051461],
  [-0.250268, 1.204414, 0.045854],
  [-0.002079, 0.048952, 0.953127],
];
const CAT16_INVERSE = invert3(CAT16);
const XYZ_TO_AP1 = [
  [1.64102338, -0.32480329, -0.2364247],
  [-0.66366286, 1.61533159, 0.01675635],
  [0.01172189, -0.00828444, 0.98839486],
];
const AP1_TO_XYZ = invert3(XYZ_TO_AP1);
export const D60_XY = [0.32168, 0.33767] as const;

export const cctToXy = (kelvin: number): [number, number] => {
  if (!Number.isFinite(kelvin) || kelvin < 1667 || kelvin > 25000) throw new Error('white_balance_cct_out_of_range');
  const x =
    kelvin <= 4000
      ? -0.2661239e9 / kelvin ** 3 - 0.234358e6 / kelvin ** 2 + 0.8776956e3 / kelvin + 0.17991
      : -3.0258469e9 / kelvin ** 3 + 2.1070379e6 / kelvin ** 2 + 0.2226347e3 / kelvin + 0.24039;
  const y =
    kelvin <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : kelvin <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
};

const xyToUv = ([x, y]: readonly number[]): [number, number] => {
  const denominator = -2 * (x ?? 0) + 12 * (y ?? 0) + 3;
  return [(4 * (x ?? 0)) / denominator, (6 * (y ?? 0)) / denominator];
};

const uvToXy = ([u, v]: readonly number[]): [number, number] => {
  const denominator = 2 * (u ?? 0) - 8 * (v ?? 0) + 4;
  return [(3 * (u ?? 0)) / denominator, (2 * (v ?? 0)) / denominator];
};

export const cctDuvToXy = (kelvin: number, duv: number): [number, number] => {
  if (!Number.isFinite(duv) || Math.abs(duv) > 0.05) throw new Error('white_balance_duv_out_of_range');
  const locus = xyToUv(cctToXy(kelvin));
  const step = Math.max(1, kelvin * 0.002);
  const lo = xyToUv(cctToXy(Math.max(1667, kelvin - step)));
  const hi = xyToUv(cctToXy(Math.min(25000, kelvin + step)));
  const tangent = [hi[0] - lo[0], hi[1] - lo[1]];
  const length = Math.hypot(...tangent);
  return uvToXy([locus[0] - ((tangent[1] ?? 0) / length) * duv, locus[1] + ((tangent[0] ?? 0) / length) * duv]);
};

const xyToXyz = ([x, y]: readonly number[]): number[] => [(x ?? 0) / (y ?? 1), 1, (1 - (x ?? 0) - (y ?? 0)) / (y ?? 1)];

export const technicalWhiteBalanceMatrix = (settings: TechnicalWhiteBalance): number[][] => {
  if (settings.mode === 'as_shot')
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  const source =
    settings.mode === 'chromaticity' ? [settings.x, settings.y] : cctDuvToXy(settings.kelvin, settings.duv);
  const sourceLms = multiplyVector(CAT16, xyToXyz(source));
  const destinationLms = multiplyVector(CAT16, xyToXyz(D60_XY));
  const scale: [number, number, number] = [
    (destinationLms[0] ?? 1) / (sourceLms[0] ?? 1),
    (destinationLms[1] ?? 1) / (sourceLms[1] ?? 1),
    (destinationLms[2] ?? 1) / (sourceLms[2] ?? 1),
  ];
  const cat = multiply(
    CAT16_INVERSE,
    multiply(
      [
        [scale[0], 0, 0],
        [0, scale[1], 0],
        [0, 0, scale[2]],
      ],
      CAT16,
    ),
  );
  return multiply(XYZ_TO_AP1, multiply(cat, AP1_TO_XYZ));
};

export const buildTechnicalWhiteBalance = (
  mode: WhiteBalanceMode,
  kelvin = 6504,
  duv = 0,
  source: TechnicalWhiteBalance['source'] = 'user',
  inputSemantics: TechnicalWhiteBalance['inputSemantics'] = 'raw_scene_linear',
): TechnicalWhiteBalance => {
  const [x, y] = mode === 'as_shot' ? D60_XY : cctDuvToXy(kelvin, duv);
  return technicalWhiteBalanceSchema.parse({
    contract: WHITE_BALANCE_CONTRACT,
    mode,
    kelvin,
    duv,
    x,
    y,
    adaptation: 'cat16_v1',
    source: mode === 'as_shot' ? 'as_shot' : source,
    confidence: null,
    sampleCount: null,
    inputSemantics,
    presetId: mode === 'preset' ? 'daylight' : null,
    synchronization: { mode: 'per_image', referenceSourceIdentity: null },
  });
};

export const buildTechnicalWhiteBalancePreset = (
  presetId: WhiteBalancePresetId,
  synchronization: TechnicalWhiteBalance['synchronization'] = {
    mode: 'per_image',
    referenceSourceIdentity: null,
  },
  inputSemantics: TechnicalWhiteBalance['inputSemantics'] = 'raw_scene_linear',
): TechnicalWhiteBalance => {
  const preset = WHITE_BALANCE_PRESETS.find(({ id }) => id === presetId);
  if (!preset) throw new Error('white_balance_preset_not_found');
  return technicalWhiteBalanceSchema.parse({
    ...buildTechnicalWhiteBalance('preset', preset.kelvin, preset.duv, 'preset', inputSemantics),
    presetId,
    synchronization,
  });
};

export const INITIAL_TECHNICAL_WHITE_BALANCE = buildTechnicalWhiteBalance('as_shot');
