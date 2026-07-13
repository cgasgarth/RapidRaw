import { z } from 'zod';

const finiteNumberSchema = z.number().finite();
const rgbSchema = z.tuple([finiteNumberSchema, finiteNumberSchema, finiteNumberSchema]);
const matrix3Schema = z.tuple([rgbSchema, rgbSchema, rgbSchema]);

export const normalizedChartPointSchema = z
  .object({ x: finiteNumberSchema.min(0).max(1), y: finiteNumberSchema.min(0).max(1) })
  .strict();
export const chartGeometrySchema = z
  .object({
    corners: z.tuple([
      normalizedChartPointSchema,
      normalizedChartPointSchema,
      normalizedChartPointSchema,
      normalizedChartPointSchema,
    ]),
    mirrored: z.boolean(),
  })
  .strict();
const chartSampleSchema = z
  .object({
    patchId: z.string().min(1),
    role: z.enum(['neutral', 'skin', 'chromatic']),
    cameraRgbMean: rgbSchema,
    cameraRgbMedian: rgbSchema,
    covariance: matrix3Schema,
    clippedFraction: finiteNumberSchema.min(0).max(1),
    validFraction: finiteNumberSchema.min(0).max(1),
    spatialGradient: finiteNumberSchema.nonnegative(),
    sharpness: finiteNumberSchema.nonnegative(),
    sampleCount: z.number().int().positive(),
  })
  .strict();
const captureQualitySchema = z
  .object({
    chartAreaFraction: finiteNumberSchema.min(0).max(1),
    minimumPatchAreaPixels: finiteNumberSchema.nonnegative(),
    maximumClippedFraction: finiteNumberSchema.min(0).max(1),
    maximumSpatialGradient: finiteNumberSchema.nonnegative(),
    minimumPatchSharpness: finiteNumberSchema.nonnegative(),
    warningCodes: z.array(z.string().min(1)),
    accepted: z.boolean(),
  })
  .strict();
export const chartSamplingReceiptSchema = z
  .object({
    contract: z.literal('rapidraw.chart_calibration.v1'),
    chartId: z.string().min(1),
    chartVersion: z.number().int().positive(),
    sourceRevision: z.string().min(1),
    cameraIdentity: z.string().min(1),
    inputDomain: z.literal('raw_camera_linear_after_sensor_correction_before_wb_profile_view_output'),
    geometry: chartGeometrySchema,
    samples: z.array(chartSampleSchema).length(24),
    captureQuality: captureQualitySchema,
  })
  .strict();
export const illuminantCoordinatesSchema = z
  .object({
    x: finiteNumberSchema.positive().max(1),
    y: finiteNumberSchema.positive().max(1),
    cctKelvin: finiteNumberSchema.positive().nullable(),
    duv: finiteNumberSchema.min(-0.05).max(0.05).nullable(),
  })
  .strict()
  .refine(({ x, y }) => x + y < 1, 'Illuminant x + y must be less than 1.');
const colorErrorMetricsSchema = z
  .object({
    meanDeltaE00: finiteNumberSchema.nonnegative(),
    medianDeltaE00: finiteNumberSchema.nonnegative(),
    p95DeltaE00: finiteNumberSchema.nonnegative(),
    maxDeltaE00: finiteNumberSchema.nonnegative(),
    neutralAxisError: finiteNumberSchema.nonnegative(),
    skinMeanDeltaE00: finiteNumberSchema.nonnegative().nullable(),
  })
  .strict();
export const calibrationFitReceiptSchema = z
  .object({
    contract: z.literal('rapidraw.chart_calibration.v1'),
    implementationVersion: z.literal(1),
    cameraIdentity: z.string().min(1),
    sourceRevision: z.string().min(1),
    rawProcessingProfile: z.string().min(1),
    chartId: z.string().min(1),
    chartVersion: z.number().int().positive(),
    chartReferenceIlluminant: z.string().min(1),
    chartObserver: z.string().min(1),
    chartProvenance: z.string().min(1),
    chartLicense: z.literal('CC0-1.0'),
    chartSourceUrl: z.string().url(),
    illuminant: illuminantCoordinatesSchema,
    adaptation: z.string().min(1),
    trainPatchIds: z.array(z.string().min(1)),
    validationPatchIds: z.array(z.string().min(1)),
    cameraToXyz: matrix3Schema,
    conditionNumber: finiteNumberSchema.nonnegative(),
    rejectedPatchIds: z.array(z.string().min(1)),
    trainMetrics: colorErrorMetricsSchema,
    validationMetrics: colorErrorMetricsSchema,
    residualModelAccepted: z.boolean(),
    qualityStatus: z.enum([
      'excellent',
      'acceptable',
      'warning_publishable',
      'failed_capture_quality',
      'failed_solver',
      'failed_validation_overfit',
    ]),
    warningCodes: z.array(z.string().min(1)),
    solverFingerprint: z.string().min(1),
  })
  .strict();
export const calibrationJobResultSchema = z
  .object({
    receipt: calibrationFitReceiptSchema,
    publishedProfileId: z.string().min(1).nullable(),
  })
  .strict();
export const dualCalibrationJobResultSchema = z
  .object({
    publishedProfileId: z.string().min(1),
    warmSolverFingerprint: z.string().min(1),
    coolSolverFingerprint: z.string().min(1),
    interpolationContract: z.literal('dcp_reciprocal_temperature_v1'),
  })
  .strict();

export type ChartGeometry = z.infer<typeof chartGeometrySchema>;
export type ChartSamplingReceipt = z.infer<typeof chartSamplingReceiptSchema>;
export type IlluminantCoordinates = z.infer<typeof illuminantCoordinatesSchema>;
export type CalibrationJobResult = z.infer<typeof calibrationJobResultSchema>;
export type CalibrationFitReceipt = z.infer<typeof calibrationFitReceiptSchema>;
