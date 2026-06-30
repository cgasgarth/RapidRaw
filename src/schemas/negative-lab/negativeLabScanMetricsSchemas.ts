import { z } from 'zod';

export const NEGATIVE_LAB_SCAN_METRICS_SCHEMA_VERSION = 1;

const finiteNumberSchema = z.number().refine(Number.isFinite, { message: 'Expected a finite number.' });
const finiteNonnegativeNumberSchema = finiteNumberSchema.refine((value) => value >= 0, {
  message: 'Expected a nonnegative finite number.',
});

export const negativeLabScanMetricsWarningCodeSchema = z.enum([
  'border_density_contamination',
  'insufficient_density_samples',
  'low_density_frame',
  'near_flat_density_field',
]);

export const negativeLabScanMetricsRectSchema = z
  .object({
    height: finiteNonnegativeNumberSchema,
    width: finiteNonnegativeNumberSchema,
    x: finiteNonnegativeNumberSchema,
    y: finiteNonnegativeNumberSchema,
  })
  .strict();

export const negativeLabScanMetricsPercentilesSchema = z
  .object({
    p02: finiteNumberSchema,
    p10: finiteNumberSchema,
    p25: finiteNumberSchema,
    p50: finiteNumberSchema,
    p75: finiteNumberSchema,
    p90: finiteNumberSchema,
    p98: finiteNumberSchema,
  })
  .strict()
  .superRefine((percentiles, context) => {
    const orderedValues = [
      percentiles.p02,
      percentiles.p10,
      percentiles.p25,
      percentiles.p50,
      percentiles.p75,
      percentiles.p90,
      percentiles.p98,
    ];
    for (let index = 1; index < orderedValues.length; index += 1) {
      const currentValue = orderedValues[index] ?? Number.POSITIVE_INFINITY;
      const previousValue = orderedValues[index - 1] ?? Number.NEGATIVE_INFINITY;
      if (currentValue < previousValue) {
        context.addIssue({ code: 'custom', message: 'Scan metric percentiles must be monotonic.' });
        return;
      }
    }
  });

export const negativeLabScanMetricsChannelSchema = z
  .object({
    densityPercentiles: negativeLabScanMetricsPercentilesSchema,
    deviationBounds: z
      .object({
        lower: finiteNumberSchema,
        upper: finiteNumberSchema,
      })
      .strict()
      .refine((bounds) => bounds.lower <= bounds.upper, {
        message: 'Channel deviation lower bound must not exceed upper bound.',
      }),
  })
  .strict();

export const negativeLabScanMetricsV1Schema = z
  .object({
    analysisCrop: negativeLabScanMetricsRectSchema,
    border: z
      .object({
        densityDeltaFromInsetP50: finiteNumberSchema,
        sampleCount: z.number().int().nonnegative(),
      })
      .strict(),
    channels: z
      .object({
        blue: negativeLabScanMetricsChannelSchema,
        green: negativeLabScanMetricsChannelSchema,
        red: negativeLabScanMetricsChannelSchema,
      })
      .strict(),
    clippingCounts: z
      .object({
        invalidSampleCount: z.number().int().nonnegative(),
        nonpositiveTransmittanceCount: z.number().int().nonnegative(),
        unityOrHigherTransmittanceCount: z.number().int().nonnegative(),
      })
      .strict(),
    densityRangeUnclamped: finiteNonnegativeNumberSchema,
    geometry: z
      .object({
        imageHeight: z.number().int().positive(),
        imageWidth: z.number().int().positive(),
        insetCrop: negativeLabScanMetricsRectSchema,
        insetFraction: finiteNonnegativeNumberSchema,
        sampleStride: z.number().int().positive(),
      })
      .strict(),
    highDensityReference: finiteNumberSchema,
    lumaDensityPercentiles: negativeLabScanMetricsPercentilesSchema,
    p50AnchorDensity: finiteNumberSchema,
    sampleCount: z.number().int().nonnegative(),
    schemaVersion: z.literal(NEGATIVE_LAB_SCAN_METRICS_SCHEMA_VERSION),
    shadowReference: finiteNumberSchema,
    texturalDensityRangeP10P90: finiteNonnegativeNumberSchema,
    warningCodes: z.array(negativeLabScanMetricsWarningCodeSchema),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (metrics.sampleCount === 0 && !metrics.warningCodes.includes('insufficient_density_samples')) {
      context.addIssue({
        code: 'custom',
        message: 'Empty Negative Lab scan metrics must report insufficient samples.',
        path: ['warningCodes'],
      });
    }

    if (
      metrics.texturalDensityRangeP10P90 !==
      metrics.lumaDensityPercentiles.p90 - metrics.lumaDensityPercentiles.p10
    ) {
      context.addIssue({
        code: 'custom',
        message: 'P10-P90 textural density range is stale.',
        path: ['texturalDensityRangeP10P90'],
      });
    }

    if (metrics.p50AnchorDensity !== metrics.lumaDensityPercentiles.p50) {
      context.addIssue({ code: 'custom', message: 'P50 anchor density is stale.', path: ['p50AnchorDensity'] });
    }
  });

export type NegativeLabScanMetricsWarningCode = z.infer<typeof negativeLabScanMetricsWarningCodeSchema>;
export type NegativeLabScanMetricsRect = z.infer<typeof negativeLabScanMetricsRectSchema>;
export type NegativeLabScanMetricsPercentiles = z.infer<typeof negativeLabScanMetricsPercentilesSchema>;
export type NegativeLabScanMetricsV1 = z.infer<typeof negativeLabScanMetricsV1Schema>;

export const parseNegativeLabScanMetricsV1 = (value: unknown): NegativeLabScanMetricsV1 =>
  negativeLabScanMetricsV1Schema.parse(value);
