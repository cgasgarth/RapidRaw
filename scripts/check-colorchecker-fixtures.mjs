#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const ColorCheckerFixtureIdSchema = z.string().regex(/^colorchecker\.[a-z0-9.-]+\.v[0-9]+$/u);

const LicenseSchema = z
  .object({
    evidence: z.string().trim().min(1),
    spdx: z.string().trim().min(1),
  })
  .strict();

const MeasurementSchema = z
  .object({
    referenceIlluminant: z.enum(['D50', 'D55', 'D65', 'unknown']),
    referenceObserver: z.enum(['2deg', '10deg', 'unknown']),
    referenceSpace: z.enum(['cie_lab', 'xyz_d50', 'acescg_linear_v1']),
    source: z.enum(['synthetic_reference_values', 'future_measured_reference', 'measured_reference']),
  })
  .strict();

const PatchGeometrySchema = z
  .object({
    columns: z.number().int().positive(),
    rows: z.number().int().positive(),
  })
  .strict();

const ColorCheckerFixtureSchema = z
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
    fixtureId: ColorCheckerFixtureIdSchema,
    license: LicenseSchema,
    measurement: MeasurementSchema,
    notes: z.string().trim().min(1),
    patchGeometry: PatchGeometrySchema,
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

const ColorCheckerFixtureManifestSchema = z
  .object({
    $schema: z.string().url(),
    fixtures: z.array(ColorCheckerFixtureSchema).min(1),
    issue: z.literal(88),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
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

const manifestPath = resolve('fixtures/color/colorchecker-fixture-manifest.json');
const manifest = ColorCheckerFixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));

const activeAssets = manifest.fixtures.filter((fixture) => fixture.assetState === 'active_asset');
if (activeAssets.length > 0) {
  throw new Error('ColorChecker fixtures are metadata-only until real asset provenance and hashes are added.');
}

console.log(`Validated ${manifest.fixtures.length} ColorChecker fixture definitions.`);
