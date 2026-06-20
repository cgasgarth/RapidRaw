import { z } from 'zod';

import type { SuperResolutionRuntimeFrameV1 } from './superResolutionRuntimePlan.js';

const SR_ALIGNMENT_DIAGNOSTIC_ALGORITHM_ID = 'declared_pixel_shift_lattice_diagnostics_v1';

export const superResolutionAlignmentDiagnosticsV1Schema = z
  .object({
    algorithmId: z.literal(SR_ALIGNMENT_DIAGNOSTIC_ALGORITHM_ID),
    confidence: z.number().min(0).max(1),
    duplicateShiftPhases: z
      .array(
        z
          .object({
            count: z.number().int().min(2),
            shiftX: z.number().int().nonnegative(),
            shiftY: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .optional(),
    expectedShiftPhases: z.array(
      z
        .object({
          shiftX: z.number().int().nonnegative(),
          shiftY: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    frameCount: z.number().int().positive(),
    geometryConsistent: z.boolean(),
    limitations: z.array(z.string().trim().min(1)).min(1),
    missingShiftPhases: z
      .array(
        z
          .object({
            shiftX: z.number().int().nonnegative(),
            shiftY: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .optional(),
    phaseCoverageRatio: z.number().min(0).max(1),
    referenceSourceIndex: z.number().int().nonnegative(),
    status: z.enum(['complete_declared_lattice', 'degraded_declared_lattice']),
    uniqueShiftPhaseCount: z.number().int().nonnegative(),
  })
  .strict();

export type SuperResolutionAlignmentDiagnosticsV1 = z.infer<typeof superResolutionAlignmentDiagnosticsV1Schema>;

export const buildSuperResolutionAlignmentDiagnosticsV1 = (
  frames: SuperResolutionRuntimeFrameV1[],
  outputScale: number,
): SuperResolutionAlignmentDiagnosticsV1 => {
  const referenceFrame = frames[0];
  if (referenceFrame === undefined) {
    throw new Error('Super-resolution alignment diagnostics require at least one frame.');
  }

  const expectedShiftPhases = buildExpectedShiftPhases(outputScale);
  const expectedPhaseKeys = new Set(expectedShiftPhases.map((phase) => shiftPhaseKey(phase.shiftX, phase.shiftY)));
  const observedPhaseCounts = new Map<string, { count: number; shiftX: number; shiftY: number }>();
  for (const frame of frames) {
    const key = shiftPhaseKey(frame.shiftX, frame.shiftY);
    const existing = observedPhaseCounts.get(key);
    observedPhaseCounts.set(key, {
      count: (existing?.count ?? 0) + 1,
      shiftX: frame.shiftX,
      shiftY: frame.shiftY,
    });
  }

  const coveredExpectedPhaseCount = [...observedPhaseCounts.keys()].filter((key) => expectedPhaseKeys.has(key)).length;
  const missingShiftPhases = expectedShiftPhases.filter(
    (phase) => !observedPhaseCounts.has(shiftPhaseKey(phase.shiftX, phase.shiftY)),
  );
  const duplicateShiftPhases = [...observedPhaseCounts.values()]
    .filter((phase) => phase.count > 1)
    .sort(compareShiftPhaseWithCount)
    .map((phase) => ({
      count: phase.count,
      shiftX: phase.shiftX,
      shiftY: phase.shiftY,
    }));
  const geometryConsistent = frames.every(
    (frame) => frame.width === referenceFrame.width && frame.height === referenceFrame.height,
  );
  const phaseCoverageRatio = roundMetric(coveredExpectedPhaseCount / Math.max(1, expectedShiftPhases.length));
  const duplicatePenalty = Math.min(
    0.5,
    duplicateShiftPhases.reduce((total, phase) => total + phase.count - 1, 0) * 0.125,
  );
  const geometryPenalty = geometryConsistent ? 0 : 0.5;
  const confidence = roundMetric(Math.max(0, phaseCoverageRatio - duplicatePenalty - geometryPenalty));
  const status =
    missingShiftPhases.length === 0 && duplicateShiftPhases.length === 0 && geometryConsistent
      ? 'complete_declared_lattice'
      : 'degraded_declared_lattice';

  return superResolutionAlignmentDiagnosticsV1Schema.parse({
    algorithmId: SR_ALIGNMENT_DIAGNOSTIC_ALGORITHM_ID,
    confidence,
    ...(duplicateShiftPhases.length > 0 ? { duplicateShiftPhases } : {}),
    expectedShiftPhases,
    frameCount: frames.length,
    geometryConsistent,
    limitations: [
      'declared_integer_offsets_only',
      'no_rotation_scale_or_perspective_estimation',
      'no_optical_flow_or_local_warp_estimation',
      'no_photometric_normalization',
    ],
    ...(missingShiftPhases.length > 0 ? { missingShiftPhases } : {}),
    phaseCoverageRatio,
    referenceSourceIndex: referenceFrame.sourceIndex,
    status,
    uniqueShiftPhaseCount: observedPhaseCounts.size,
  });
};

export const assertSuperResolutionAlignmentDiagnosticsRenderableV1 = (
  diagnostics: SuperResolutionAlignmentDiagnosticsV1,
): void => {
  if (!diagnostics.geometryConsistent) {
    throw new Error('Super-resolution alignment requires source frames with matching dimensions.');
  }
  if (diagnostics.missingShiftPhases !== undefined && diagnostics.missingShiftPhases.length > 0) {
    throw new Error(
      `Super-resolution alignment requires a complete declared shift lattice; missing phases ${diagnostics.missingShiftPhases
        .map((phase) => `(${phase.shiftX},${phase.shiftY})`)
        .join(', ')}.`,
    );
  }
  if (diagnostics.duplicateShiftPhases !== undefined && diagnostics.duplicateShiftPhases.length > 0) {
    throw new Error(
      `Super-resolution alignment requires unique declared shift phases; duplicate phases ${diagnostics.duplicateShiftPhases
        .map((phase) => `(${phase.shiftX},${phase.shiftY})x${phase.count}`)
        .join(', ')}.`,
    );
  }
};

const buildExpectedShiftPhases = (outputScale: number): Array<{ shiftX: number; shiftY: number }> => {
  const phases: Array<{ shiftX: number; shiftY: number }> = [];
  for (let shiftY = 0; shiftY < outputScale; shiftY += 1) {
    for (let shiftX = 0; shiftX < outputScale; shiftX += 1) {
      phases.push({ shiftX, shiftY });
    }
  }
  return phases;
};

const compareShiftPhaseWithCount = (
  left: { count: number; shiftX: number; shiftY: number },
  right: { count: number; shiftX: number; shiftY: number },
): number => left.shiftY - right.shiftY || left.shiftX - right.shiftX || left.count - right.count;

const shiftPhaseKey = (shiftX: number, shiftY: number): string => `${shiftX}:${shiftY}`;

const roundMetric = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
