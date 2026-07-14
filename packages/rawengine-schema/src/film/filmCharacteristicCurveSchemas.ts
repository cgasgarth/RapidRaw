import { z } from 'zod';

export const filmCurvePolarityV1Schema = z.enum(['direct_positive', 'negative_density', 'positive_density']);

const filmDensityRangeV1Schema = z
  .object({
    dMax: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
    dMin: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  })
  .strict()
  .superRefine((range, context) => {
    range.dMin.forEach((value, index) => {
      if (value >= (range.dMax[index] ?? Number.POSITIVE_INFINITY))
        context.addIssue({ code: 'custom', message: 'dMin must be below dMax.', path: ['dMin', index] });
    });
  });

export const filmCharacteristicCurveV1Schema = z
  .object({
    density: filmDensityRangeV1Schema.optional(),
    domainEv: z.tuple([z.number().finite(), z.number().finite()]),
    endpointSlope: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]),
    exposureKnotsEv: z.array(z.number().finite()).min(5),
    model: z.literal('monotone_pchip_v1'),
    polarity: filmCurvePolarityV1Schema,
    referenceGray: z.number().finite().positive(),
    responseKnots: z.array(z.number().finite()).min(5),
  })
  .strict()
  .superRefine((curve, context) => {
    const domainStart = curve.domainEv[0] ?? Number.POSITIVE_INFINITY;
    const domainEnd = curve.domainEv[1] ?? Number.NEGATIVE_INFINITY;
    const firstExposure = curve.exposureKnotsEv[0] ?? Number.NaN;
    const lastExposure = curve.exposureKnotsEv.at(-1) ?? Number.NaN;
    if (domainStart >= domainEnd)
      context.addIssue({ code: 'custom', message: 'Curve domain must be ordered.', path: ['domainEv'] });
    if (curve.exposureKnotsEv.length !== curve.responseKnots.length)
      context.addIssue({ code: 'custom', message: 'Curve knots must have equal lengths.', path: ['responseKnots'] });
    if (firstExposure !== domainStart || lastExposure !== domainEnd)
      context.addIssue({
        code: 'custom',
        message: 'Curve knots must span the declared domain.',
        path: ['exposureKnotsEv'],
      });
    if (curve.exposureKnotsEv.some((value, index) => index > 0 && value <= (curve.exposureKnotsEv[index - 1] ?? value)))
      context.addIssue({
        code: 'custom',
        message: 'Exposure knots must be strictly increasing.',
        path: ['exposureKnotsEv'],
      });
    if (curve.responseKnots.some((value, index) => index > 0 && value < (curve.responseKnots[index - 1] ?? value)))
      context.addIssue({ code: 'custom', message: 'Response knots must be monotone.', path: ['responseKnots'] });
    const anchorIndex = curve.exposureKnotsEv.findIndex((value) => Math.abs(value) <= Number.EPSILON);
    if (anchorIndex < 0 || Math.abs(curve.responseKnots[anchorIndex] ?? Number.NaN) > 1e-6)
      context.addIssue({
        code: 'custom',
        message: 'Curve must include an exact 18% gray anchor.',
        path: ['responseKnots'],
      });
  });

export type FilmCharacteristicCurveV1 = z.infer<typeof filmCharacteristicCurveV1Schema>;

const slopes = (curve: FilmCharacteristicCurveV1): number[] => {
  const output = Array.from({ length: curve.exposureKnotsEv.length }, () => 0);
  const deltas = curve.exposureKnotsEv
    .slice(1)
    .map(
      (x, index) =>
        ((curve.responseKnots[index + 1] ?? 0) - (curve.responseKnots[index] ?? 0)) /
        (x - (curve.exposureKnotsEv[index] ?? 0)),
    );
  output[0] = deltas[0] ?? 0;
  output[output.length - 1] = deltas.at(-1) ?? 0;
  for (let index = 1; index < output.length - 1; index += 1) {
    if ((deltas[index - 1] ?? 0) * (deltas[index] ?? 0) <= 0) continue;
    const h0 = (curve.exposureKnotsEv[index] ?? 0) - (curve.exposureKnotsEv[index - 1] ?? 0);
    const h1 = (curve.exposureKnotsEv[index + 1] ?? 0) - (curve.exposureKnotsEv[index] ?? 0);
    output[index] =
      (2 * h1 + h0 + h1 + 2 * h0) / ((2 * h1 + h0) / (deltas[index - 1] ?? 1) + (h1 + 2 * h0) / (deltas[index] ?? 1));
  }
  return output;
};

export const evaluateFilmCharacteristicCurveV1 = (curve: FilmCharacteristicCurveV1, exposureEv: number): number => {
  const validated = filmCharacteristicCurveV1Schema.parse(curve);
  const tangent = slopes(validated);
  const x = validated.exposureKnotsEv;
  const y = validated.responseKnots;
  const xStart = x[0] ?? 0;
  const xEnd = x.at(-1) ?? 0;
  const yStart = y[0] ?? 0;
  const yEnd = y.at(-1) ?? 0;
  const tangentStart = tangent[0] ?? 0;
  const tangentEnd = tangent.at(-1) ?? 0;
  if (exposureEv <= xStart) return yStart + tangentStart * (exposureEv - xStart);
  if (exposureEv >= xEnd) return yEnd + tangentEnd * (exposureEv - xEnd);
  const index = x.findIndex((value) => exposureEv <= value) - 1;
  const x0 = x[index] ?? xStart;
  const x1 = x[index + 1] ?? xEnd;
  const y0 = y[index] ?? yStart;
  const y1 = y[index + 1] ?? yEnd;
  const tangent0 = tangent[index] ?? tangentStart;
  const tangent1 = tangent[index + 1] ?? tangentEnd;
  const h = x1 - x0;
  const t = (exposureEv - x0) / h;
  return (
    (1 + 2 * t) * (1 - t) ** 2 * y0 +
    t * (1 - t) ** 2 * h * tangent0 +
    t ** 2 * (3 - 2 * t) * y1 +
    t ** 2 * (t - 1) * h * tangent1
  );
};

export const referenceFilmCharacteristicCurveV1: FilmCharacteristicCurveV1 = {
  model: 'monotone_pchip_v1',
  polarity: 'direct_positive',
  referenceGray: 0.18,
  domainEv: [-12, 8],
  exposureKnotsEv: [-12, -6, -2, 0, 2, 5, 8],
  responseKnots: [-10.8, -5.7, -1.8, 0, 1.75, 3.9, 5.6],
  endpointSlope: [0.84, 0.48],
};
