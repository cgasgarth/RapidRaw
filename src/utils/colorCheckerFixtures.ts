import { z } from 'zod';

export const colorCheckerFixtureIdSchema = z.string().regex(/^colorchecker\.[a-z0-9.-]+\.v[0-9]+$/u);

export const colorCheckerLicenseSchema = z
  .object({
    evidence: z.string().trim().min(1),
    spdx: z.string().trim().min(1),
  })
  .strict();

export const colorCheckerMeasurementSchema = z
  .object({
    referenceIlluminant: z.enum(['D50', 'D55', 'D65', 'unknown']),
    referenceObserver: z.enum(['2deg', '10deg', 'unknown']),
    referenceSpace: z.enum(['cie_lab', 'xyz_d50', 'acescg_linear_v1']),
    source: z.enum(['synthetic_reference_values', 'future_measured_reference', 'measured_reference']),
  })
  .strict();

export const colorCheckerPatchGeometrySchema = z
  .object({
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .strict();

export const colorCheckerFixtureSchema = z
  .object({
    assetSha256: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    assetState: z.enum(['metadata_only', 'active_asset']),
    captureKind: z.enum(['synthetic_chart', 'raw_camera_chart', 'rendered_tiff_chart']),
    colorPipelineStage: z.enum([
      'camera_profile_to_working_space',
      'working_space_to_display_transform',
      'negative_positive_handoff',
    ]),
    expectedPatchCount: z.number().int().positive(),
    fixtureId: colorCheckerFixtureIdSchema,
    license: colorCheckerLicenseSchema,
    measurement: colorCheckerMeasurementSchema,
    notes: z.string().trim().min(1),
    patchGeometry: colorCheckerPatchGeometrySchema,
    status: z.enum(['planned', 'active_metadata_only', 'active_asset']),
    validationUses: z
      .array(
        z.enum([
          'camera_profile_regression',
          'deltae_harness_bootstrap',
          'neutral_patch_gate',
          'preview_export_parity',
          'schema_contract',
        ]),
      )
      .min(1),
  })
  .strict()
  .superRefine((fixture, context) => {
    const patchSlots = fixture.patchGeometry.columns * fixture.patchGeometry.rows;
    if (patchSlots !== fixture.expectedPatchCount) {
      context.addIssue({
        code: 'custom',
        message: 'Patch geometry must match expectedPatchCount.',
        path: ['patchGeometry'],
      });
    }

    if (fixture.assetState === 'active_asset' && fixture.assetSha256 === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Active ColorChecker assets require assetSha256.',
        path: ['assetSha256'],
      });
    }

    if (fixture.assetState === 'metadata_only' && fixture.status === 'active_asset') {
      context.addIssue({
        code: 'custom',
        message: 'Metadata-only fixtures cannot use active_asset status.',
        path: ['status'],
      });
    }
  });

export const colorCheckerFixtureManifestSchema = z
  .object({
    $schema: z.url(),
    fixtures: z.array(colorCheckerFixtureSchema).min(1),
    issue: z.literal(88),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.fixtures.map((fixture) => fixture.fixtureId);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'ColorChecker fixture IDs must be unique.',
        path: ['fixtures'],
      });
    }

    const requiredIds = [
      'colorchecker.raw.camera-profile-baseline.v1',
      'colorchecker.synthetic.acescg-neutral-ramp.v1',
    ];
    const sortedFixtureIds = [...fixtureIds].sort();
    if (JSON.stringify(sortedFixtureIds) !== JSON.stringify(requiredIds)) {
      context.addIssue({
        code: 'custom',
        message: `ColorChecker manifest must contain: ${requiredIds.join(', ')}.`,
        path: ['fixtures'],
      });
    }
  });

export type ColorCheckerFixture = z.infer<typeof colorCheckerFixtureSchema>;
export type ColorCheckerFixtureManifest = z.infer<typeof colorCheckerFixtureManifestSchema>;

export const parseColorCheckerFixtureManifest = (value: unknown): ColorCheckerFixtureManifest =>
  colorCheckerFixtureManifestSchema.parse(value);

export const listActiveColorCheckerAssets = (manifest: ColorCheckerFixtureManifest): Array<ColorCheckerFixture> =>
  manifest.fixtures.filter((fixture) => fixture.assetState === 'active_asset');
