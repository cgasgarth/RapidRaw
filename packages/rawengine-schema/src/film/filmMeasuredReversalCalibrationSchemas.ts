import { z } from 'zod';

export const filmMeasuredReversalCalibrationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().trim().min(1),
    sourceSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    trainSampleIds: z.array(z.string().trim().min(1)).min(5),
    holdoutSampleIds: z.array(z.string().trim().min(1)).min(5),
    exposureKnotsEv: z.array(z.number().finite()).min(2),
    densityKnots: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])).min(2),
    holdoutDensityRmse: z.number().finite().nonnegative().max(0.025),
    highlightReferenceErrorEv: z
      .number()
      .finite()
      .nonnegative()
      .max(1 / 6),
    ap1ExcursionCount: z.number().int().nonnegative(),
    fitInputSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    limitations: z.array(z.string().trim().min(1)).min(1),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.trainSampleIds.some((id) => report.holdoutSampleIds.includes(id)))
      context.addIssue({
        code: 'custom',
        message: 'Train and holdout samples must be disjoint.',
        path: ['holdoutSampleIds'],
      });
    if (report.exposureKnotsEv.length !== report.densityKnots.length)
      context.addIssue({ code: 'custom', message: 'Exposure and density knots must align.', path: ['densityKnots'] });
  });

export type FilmMeasuredReversalCalibrationV1 = z.infer<typeof filmMeasuredReversalCalibrationV1Schema>;
