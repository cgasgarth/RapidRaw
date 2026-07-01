import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

import {
  applyCameraProfileInputTransform,
  type CameraProfileRgbPixel,
  cameraProfileMatrix3x3Schema,
  cameraProfileRgbPixelSchema,
} from '../../../src/utils/color/runtime/cameraProfileInputTransformRuntime';
import { linearSrgbToXyzD65, type XyzColor } from '../../../src/utils/color/runtime/chromaticAdaptation';
import { calculateDeltaE00, type LabColor, labColorSchema } from '../../../src/utils/deltaE00';

const FIXTURE_PATH = 'fixtures/color/proofs/colorchecker-deltae-gate.json';
const TOP_FAILURE_LIMIT = 3;

const patchSchema = z
  .object({
    expectedWorkingLab: labColorSchema,
    expectedWorkingRgb: cameraProfileRgbPixelSchema,
    id: z.string().regex(/^[a-z0-9-]+$/u),
    inputCameraRgb: cameraProfileRgbPixelSchema,
    maxDeltaE00: z.number().positive().max(1),
    maxRgbAbsDelta: z.number().positive().max(0.001),
  })
  .strict();

const fixtureSchema = z
  .object({
    $schema: z.string().url(),
    assumptions: z
      .object({
        colorJsRole: z.literal('oracle_only_for_existing_deltae_unit_tests_not_this_runtime_gate'),
        comparisonSpace: z.literal('cie_lab_d65_from_linear_srgb_working_rgb'),
        fixtureScope: z.string().includes('drift detection'),
        inputEncoding: z.literal('linear_camera_rgb_0_to_1'),
        runtimeStage: z.literal('camera_profile_to_working_space'),
      })
      .strict(),
    cameraToWorkingMatrix: cameraProfileMatrix3x3Schema,
    fixtureId: z.literal('colorchecker.synthetic.deltae-runtime-gate.v1'),
    issue: z.literal(4532),
    patches: z.array(patchSchema).length(6),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
    validationMode: z.literal('synthetic_colorchecker_camera_profile_deltae_gate'),
  })
  .strict()
  .superRefine((fixture, context) => {
    const ids = fixture.patches.map((patch) => patch.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        message: 'ColorChecker deltaE gate patch IDs must be unique.',
        path: ['patches'],
      });
    }
  });

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')));

describe('ColorChecker-style DeltaE runtime gate', () => {
  test('keeps synthetic camera-profile patch drift within documented thresholds', () => {
    const reports = fixture.patches.map((patch) => {
      const actualWorkingRgb = applyCameraProfileInputTransform(patch.inputCameraRgb, fixture.cameraToWorkingMatrix);
      const actualWorkingLab = linearSrgbToLabD65(actualWorkingRgb);
      const deltaE00 = roundMetric(calculateDeltaE00(actualWorkingLab, patch.expectedWorkingLab));
      const maxRgbAbsDelta = roundMetric(maxRgbChannelDelta(actualWorkingRgb, patch.expectedWorkingRgb));

      return {
        deltaE00,
        id: patch.id,
        maxDeltaE00: patch.maxDeltaE00,
        maxRgbAbsDelta,
        maxRgbAbsDeltaLimit: patch.maxRgbAbsDelta,
      };
    });

    const failures = reports
      .filter((report) => report.deltaE00 > report.maxDeltaE00 || report.maxRgbAbsDelta > report.maxRgbAbsDeltaLimit)
      .toSorted(
        (left, right) =>
          Math.max(right.deltaE00 / right.maxDeltaE00, right.maxRgbAbsDelta / right.maxRgbAbsDeltaLimit) -
          Math.max(left.deltaE00 / left.maxDeltaE00, left.maxRgbAbsDelta / left.maxRgbAbsDeltaLimit),
      );

    if (failures.length > 0) {
      throw new Error(
        [
          `ColorChecker deltaE gate failed for ${failures.length}/${reports.length} patches.`,
          ...failures
            .slice(0, TOP_FAILURE_LIMIT)
            .map(
              (failure) =>
                `${failure.id}: DeltaE00 ${failure.deltaE00} > ${failure.maxDeltaE00}; RGB max abs ${failure.maxRgbAbsDelta} > ${failure.maxRgbAbsDeltaLimit}`,
            ),
        ].join('\n'),
      );
    }

    expect(Math.max(...reports.map((report) => report.deltaE00))).toBeLessThanOrEqual(0.005);
  });
});

const D65_REFERENCE_WHITE: XyzColor = [0.95047, 1, 1.08883];
const CIE_EPSILON = 216 / 24389;
const CIE_KAPPA = 24389 / 27;

function linearSrgbToLabD65(rgb: CameraProfileRgbPixel): LabColor {
  const xyz = linearSrgbToXyzD65(rgb);
  const x = cieLabPivot(xyz[0] / D65_REFERENCE_WHITE[0]);
  const y = cieLabPivot(xyz[1] / D65_REFERENCE_WHITE[1]);
  const zValue = cieLabPivot(xyz[2] / D65_REFERENCE_WHITE[2]);

  return labColorSchema.parse({
    a: roundMetric(500 * (x - y)),
    b: roundMetric(200 * (y - zValue)),
    l: roundMetric(116 * y - 16),
  });
}

function cieLabPivot(value: number): number {
  return value > CIE_EPSILON ? Math.cbrt(value) : (CIE_KAPPA * value + 16) / 116;
}

function maxRgbChannelDelta(actual: CameraProfileRgbPixel, expected: CameraProfileRgbPixel): number {
  return Math.max(
    Math.abs(actual.red - expected.red),
    Math.abs(actual.green - expected.green),
    Math.abs(actual.blue - expected.blue),
  );
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
