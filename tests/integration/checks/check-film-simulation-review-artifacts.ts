#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

const outputPath = resolve('fixtures/film-simulation/film-simulation-review-artifacts.json');
const parityPath = resolve('fixtures/film-simulation/film-look-preview-export-parity.json');
const filmFixturePath = resolve('fixtures/film-simulation/film-look-fixture-outputs.json');
const updateFixture = process.argv.includes('--update');
const width = 18;
const height = 10;

const hash16Schema = z.string().regex(/^[a-f0-9]{16}$/u);
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const provenanceStatusSchema = z.enum([
  'generic_engineered_not_measured_stock',
  'stock_family_reference_metadata_not_measured_stock',
]);

const parityManifestSchema = z
  .object({
    cases: z.array(
      z
        .object({
          baselinePreviewMaxDelta: z.number().positive(),
          caseId: z.string().trim().min(1),
          displayName: z.string().trim().min(1),
          exportHash: hash16Schema,
          lookId: z.string().trim().min(1),
          previewExportMaxDelta: z.literal(0),
          previewHash: hash16Schema,
          strength: z.number().int().min(0).max(100),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const filmFixtureSchema = z
  .object({
    outputs: z.array(
      z
        .object({
          category: z.string().trim().min(1),
          id: z.string().trim().min(1),
          provenance: z
            .object({
              claimLevel: z.enum(['generic_engineered', 'stock_family_reference_metadata']),
              legalNamingStatus: z.enum(['generic_safe_name', 'descriptive_stock_family']),
              legalNote: z.string().trim().min(1),
              measurementSource: z.enum(['generic_engineered_starting_point', 'research_reference_metadata_only']),
            })
            .strict(),
          runtimeSupport: z.literal('adjustment_patch_preview_export'),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const reviewArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    beforeImage: z
      .object({
        hash: hashSchema,
        kind: z.literal('synthetic_before_image'),
        scene: z.literal('ramp-color-chips-highlight-edge'),
      })
      .strict(),
    cases: z.array(
      z
        .object({
          afterImage: z
            .object({
              exportHash: hash16Schema,
              kind: z.literal('synthetic_after_preview_export_pair'),
              previewHash: hash16Schema,
            })
            .strict(),
          baselinePreviewMaxDelta: z.number().positive(),
          category: z.string().trim().min(1),
          displayName: z.string().trim().min(1),
          lookId: z.string().trim().min(1),
          previewExportMaxDelta: z.literal(0),
          provenanceStatus: provenanceStatusSchema,
          runtimeStatus: z.literal('synthetic_preview_export_parity'),
          runtimeSupport: z.literal('adjustment_patch_preview_export'),
          strength: z.number().int().min(0).max(100),
        })
        .strict(),
    ),
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    generatedFrom: z.literal('tests/integration/checks/check-film-simulation-review-artifacts.ts'),
    proofId: z.literal('film.simulation.review-artifacts.synthetic.v1'),
    schemaVersion: z.literal(1),
  })
  .strict();

type SourcePixel = { b: number; g: number; r: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const quantize = (value: number) => Math.round(clamp01(value) * 4095);

function makeSyntheticScene(): Array<SourcePixel> {
  const pixels: Array<SourcePixel> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ramp = x / (width - 1);
      const chip = y % 3;
      const edgeBoost = x >= width - 4 && y >= 2 && y <= height - 3 ? 0.28 : 0;
      pixels.push({
        b: clamp01(ramp * 0.72 + (chip === 2 ? 0.2 : 0.04) + edgeBoost),
        g: clamp01(ramp * 0.82 + (chip === 1 ? 0.18 : 0.03) + edgeBoost),
        r: clamp01(ramp * 0.92 + (chip === 0 ? 0.22 : 0.02) + edgeBoost),
      });
    }
  }

  return pixels;
}

function hashPixels(pixels: ReadonlyArray<SourcePixel>): string {
  const stablePixels = pixels.map(({ b, g, r }) => [quantize(r), quantize(g), quantize(b)]);
  return `sha256:${createHash('sha256').update(JSON.stringify(stablePixels)).digest('hex')}`;
}

const parityManifest = parityManifestSchema.parse(JSON.parse(await readFile(parityPath, 'utf8')));
const filmFixture = filmFixtureSchema.parse(JSON.parse(await readFile(filmFixturePath, 'utf8')));
const fixtureById = new Map(filmFixture.outputs.map((look) => [look.id, look]));

const reviewArtifact = reviewArtifactSchema.parse({
  artifactId: 'film-review-artifacts.generic-builtins.v1',
  beforeImage: {
    hash: hashPixels(makeSyntheticScene()),
    kind: 'synthetic_before_image',
    scene: 'ramp-color-chips-highlight-edge',
  },
  cases: parityManifest.cases.map((parityCase) => {
    const lookFixture = fixtureById.get(parityCase.lookId);
    if (lookFixture === undefined) {
      throw new Error(`${parityCase.lookId}: missing film fixture source.`);
    }

    return {
      afterImage: {
        exportHash: parityCase.exportHash,
        kind: 'synthetic_after_preview_export_pair',
        previewHash: parityCase.previewHash,
      },
      baselinePreviewMaxDelta: parityCase.baselinePreviewMaxDelta,
      category: lookFixture.category,
      displayName: parityCase.displayName,
      lookId: parityCase.lookId,
      previewExportMaxDelta: parityCase.previewExportMaxDelta,
      provenanceStatus:
        lookFixture.provenance.claimLevel === 'stock_family_reference_metadata'
          ? 'stock_family_reference_metadata_not_measured_stock'
          : 'generic_engineered_not_measured_stock',
      runtimeStatus: 'synthetic_preview_export_parity',
      runtimeSupport: lookFixture.runtimeSupport,
      strength: parityCase.strength,
    };
  }),
  doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'photochemical_density_domain'],
  generatedFrom: 'tests/integration/checks/check-film-simulation-review-artifacts.ts',
  proofId: 'film.simulation.review-artifacts.synthetic.v1',
  schemaVersion: 1,
});

const expected = `${JSON.stringify(reviewArtifact, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected);
  process.exit(0);
}

const current = reviewArtifactSchema.parse(JSON.parse(await readFile(outputPath, 'utf8')));
if (JSON.stringify(current) !== JSON.stringify(reviewArtifact)) {
  throw new Error(
    'Film simulation review artifacts are stale. Run bun run check:film-simulation-review-artifacts:update.',
  );
}

console.log(`film simulation review artifacts ok (${current.cases.length} looks)`);
