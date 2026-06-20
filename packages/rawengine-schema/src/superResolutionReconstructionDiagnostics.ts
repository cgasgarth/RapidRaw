import { z } from 'zod';

const SR_RECONSTRUCTION_ALGORITHM_ID = 'integer_pixel_shift_interleave_x2_v1';

export const superResolutionReconstructionDiagnosticsV1Schema = z
  .object({
    algorithmId: z.literal(SR_RECONSTRUCTION_ALGORITHM_ID),
    averageSamplesPerOutputPixel: z.number().positive(),
    duplicateSamplePixelCount: z.number().int().nonnegative(),
    duplicateSampleRatio: z.number().min(0).max(1),
    filledPixelRatio: z.number().min(0).max(1),
    finiteOutputRatio: z.number().min(0).max(1),
    missingPixelCount: z.number().int().nonnegative(),
    outputPixelCount: z.number().int().positive(),
    outputScale: z.literal(2),
    reconstructionMethod: z.literal('integer_shift_interleave_average'),
    singleSamplePixelCount: z.number().int().nonnegative(),
    status: z.enum(['accepted', 'rejected']),
    warningCodes: z.array(z.enum(['duplicate_phase_samples', 'missing_phase_samples', 'nonfinite_output_pixels'])),
  })
  .strict();

export type SuperResolutionReconstructionDiagnosticsV1 = z.infer<
  typeof superResolutionReconstructionDiagnosticsV1Schema
>;

export const buildSuperResolutionReconstructionDiagnosticsV1 = ({
  outputPixelCount,
  outputScale,
  sampleCounts,
  outputPixels,
}: {
  outputPixelCount: number;
  outputScale: number;
  sampleCounts: Uint8Array;
  outputPixels: Float32Array;
}): SuperResolutionReconstructionDiagnosticsV1 => {
  if (outputScale !== 2) {
    throw new Error(`Conservative SR reconstruction diagnostics currently support x2 output, got x${outputScale}.`);
  }

  const missingPixelCount = countSamples(sampleCounts, (count) => count === 0);
  const duplicateSamplePixelCount = countSamples(sampleCounts, (count) => count > 1);
  const singleSamplePixelCount = countSamples(sampleCounts, (count) => count === 1);
  const finiteOutputCount = outputPixels.reduce((count, value) => count + (Number.isFinite(value) ? 1 : 0), 0);
  const totalSamples = sampleCounts.reduce((total, count) => total + count, 0);
  const warningCodes: SuperResolutionReconstructionDiagnosticsV1['warningCodes'] = [];
  if (duplicateSamplePixelCount > 0) warningCodes.push('duplicate_phase_samples');
  if (missingPixelCount > 0) warningCodes.push('missing_phase_samples');
  if (finiteOutputCount !== outputPixelCount) warningCodes.push('nonfinite_output_pixels');

  return superResolutionReconstructionDiagnosticsV1Schema.parse({
    algorithmId: SR_RECONSTRUCTION_ALGORITHM_ID,
    averageSamplesPerOutputPixel: roundSrReconstructionMetric(totalSamples / Math.max(1, outputPixelCount)),
    duplicateSamplePixelCount,
    duplicateSampleRatio: roundSrReconstructionMetric(duplicateSamplePixelCount / Math.max(1, outputPixelCount)),
    filledPixelRatio: roundSrReconstructionMetric(
      (outputPixelCount - missingPixelCount) / Math.max(1, outputPixelCount),
    ),
    finiteOutputRatio: roundSrReconstructionMetric(finiteOutputCount / Math.max(1, outputPixelCount)),
    missingPixelCount,
    outputPixelCount,
    outputScale,
    reconstructionMethod: 'integer_shift_interleave_average',
    singleSamplePixelCount,
    status: missingPixelCount === 0 && finiteOutputCount === outputPixelCount ? 'accepted' : 'rejected',
    warningCodes,
  });
};

const countSamples = (samples: Uint8Array, predicate: (count: number) => boolean): number =>
  samples.reduce((count, sampleCount) => count + (predicate(sampleCount) ? 1 : 0), 0);

const roundSrReconstructionMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
