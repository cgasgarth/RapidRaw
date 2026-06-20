#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

const fixturePath = resolve('fixtures/film-simulation/film-look-render-apply-proof.json');
const sourceFixturePath = resolve('fixtures/film-simulation/film-look-fixture-outputs.json');
const updateFixture = process.argv.includes('--update');
const width = 16;
const height = 8;
const proofLookId = 'film_look.generic.warm_print.v1';

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const rgbPixelSchema = z
  .object({
    b: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

const proofArtifactSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixels: z.number().int().positive(),
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixtureInput: z
      .object({
        colorSpace: z.literal('synthetic-display-linear-rgb'),
        kind: z.literal('synthetic-film-look-render-apply-proof'),
        scene: z.literal('shadow-neutral-highlight-ramp'),
      })
      .strict(),
    generatedFrom: z.literal('tests/integration/checks/check-film-look-render-apply-proof.ts'),
    lookId: z.literal(proofLookId),
    outputPixels: z.array(rgbPixelSchema).min(1),
    previewExportStatus: z.literal('covered_by_check:film-look-preview-export-parity'),
    proofId: z.literal('film.look.runtime.render-apply.synthetic.v1'),
    provenance: z
      .object({
        claimLevel: z.literal('generic_engineered'),
        legalNamingStatus: z.literal('generic_safe_name'),
        legalNote: z.string().trim().min(1),
        measurementSource: z.literal('generic_engineered_starting_point'),
      })
      .strict(),
    renderer: z.literal('synthetic_film_look_adjustment_patch_v1'),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    runtimeSupport: z.literal('adjustment_patch_preview_export'),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.beforeHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Film look render output must change the source hash.' });
    }
  });

type RgbPixel = z.infer<typeof rgbPixelSchema>;
type ProofArtifact = z.infer<typeof proofArtifactSchema>;
const sourceFixtureProvenanceSchema = z
  .object({
    claimLevel: z.enum(['generic_engineered', 'stock_family_reference_metadata']),
    legalNamingStatus: z.enum(['descriptive_stock_family', 'generic_safe_name']),
    legalNote: z.string().trim().min(1),
    measurementSource: z.enum(['generic_engineered_starting_point', 'research_reference_metadata_only']),
  })
  .strict();
const filmLookSourceFixtureSchema = z
  .object({
    outputs: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          provenance: sourceFixtureProvenanceSchema,
          runtimeSupport: z.literal('adjustment_patch_preview_export'),
          strengthPreviews: z
            .object({
              appliedFull: z.record(z.string(), z.number()),
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const quantize = (value: number) => Math.round(clamp01(value) * 4095);

function makeSyntheticScene(): Array<RgbPixel> {
  const pixels: Array<RgbPixel> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ramp = x / (width - 1);
      const rowTint = y / (height - 1);
      pixels.push({
        b: clamp01(ramp * 0.72 + rowTint * 0.08 + 0.04),
        g: clamp01(ramp * 0.82 + (1 - rowTint) * 0.05 + 0.03),
        r: clamp01(ramp * 0.9 + rowTint * 0.1 + 0.02),
        x,
        y,
      });
    }
  }

  return pixels;
}

function applySyntheticFilmLook(sourcePixels: ReadonlyArray<RgbPixel>, patch: Record<string, number>): Array<RgbPixel> {
  const temperature = (patch.temperature ?? 0) / 100;
  const contrast = (patch.contrast ?? 0) / 100;
  const highlights = (patch.highlights ?? 0) / 100;
  const shadows = (patch.shadows ?? 0) / 100;
  const saturation = (patch.saturation ?? 0) / 100;

  return sourcePixels.map((pixel) => {
    let r = pixel.r + temperature * 0.08;
    let g = pixel.g + temperature * 0.015;
    let b = pixel.b - temperature * 0.07;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const highlightMask = clamp01((luma - 0.58) / 0.42);
    const shadowMask = clamp01((0.42 - luma) / 0.42);

    r = (r - 0.5) * (1 + contrast) + 0.5 + highlights * highlightMask * 0.18 + shadows * shadowMask * 0.14;
    g = (g - 0.5) * (1 + contrast) + 0.5 + highlights * highlightMask * 0.18 + shadows * shadowMask * 0.14;
    b = (b - 0.5) * (1 + contrast) + 0.5 + highlights * highlightMask * 0.18 + shadows * shadowMask * 0.14;

    const saturatedLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return {
      b: roundChannel(saturatedLuma + (b - saturatedLuma) * (1 + saturation)),
      g: roundChannel(saturatedLuma + (g - saturatedLuma) * (1 + saturation)),
      r: roundChannel(saturatedLuma + (r - saturatedLuma) * (1 + saturation)),
      x: pixel.x,
      y: pixel.y,
    };
  });
}

async function buildProofArtifact(): Promise<ProofArtifact> {
  const sourcePixels = makeSyntheticScene();
  const sourceFixture = filmLookSourceFixtureSchema.parse(JSON.parse(await readFile(sourceFixturePath, 'utf8')));
  const look = sourceFixture.outputs.find((item) => item.id === proofLookId);
  if (look === undefined) {
    throw new Error(`Missing film look render proof source: ${proofLookId}`);
  }

  const outputPixels = applySyntheticFilmLook(sourcePixels, look.strengthPreviews.appliedFull);

  return proofArtifactSchema.parse({
    afterHash: hashPixels(outputPixels),
    beforeHash: hashPixels(sourcePixels),
    changedPixels: countChangedPixels(sourcePixels, outputPixels),
    doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'photochemical_density_domain'],
    fixtureInput: {
      colorSpace: 'synthetic-display-linear-rgb',
      kind: 'synthetic-film-look-render-apply-proof',
      scene: 'shadow-neutral-highlight-ramp',
    },
    generatedFrom: 'tests/integration/checks/check-film-look-render-apply-proof.ts',
    lookId: look.id,
    outputPixels,
    previewExportStatus: 'covered_by_check:film-look-preview-export-parity',
    proofId: 'film.look.runtime.render-apply.synthetic.v1',
    provenance: look.provenance,
    renderer: 'synthetic_film_look_adjustment_patch_v1',
    runtimeStatus: 'synthetic_runtime_apply_capable',
    runtimeSupport: look.runtimeSupport,
    schemaVersion: 1,
  });
}

const expectedFixture = `${JSON.stringify(await buildProofArtifact(), null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, expectedFixture);
  process.exit(0);
}

const currentFixture = await readFile(fixturePath, 'utf8');
const currentArtifact = proofArtifactSchema.parse(JSON.parse(currentFixture));

if (JSON.stringify(currentArtifact) !== JSON.stringify(JSON.parse(expectedFixture))) {
  throw new Error('Film look render apply proof is stale. Run bun run check:film-look-render-apply-proof:update.');
}

console.log(`film look render apply proof ok (${currentArtifact.changedPixels} changed)`);

function countChangedPixels(before: ReadonlyArray<RgbPixel>, after: ReadonlyArray<RgbPixel>): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    if (beforePixel === undefined) return true;
    return pixel.r !== beforePixel.r || pixel.g !== beforePixel.g || pixel.b !== beforePixel.b;
  }).length;
}

function hashPixels(pixels: ReadonlyArray<RgbPixel>): string {
  const stablePixels = pixels.map(({ b, g, r }) => [quantize(r), quantize(g), quantize(b)]);
  return `sha256:${createHash('sha256').update(JSON.stringify(stablePixels)).digest('hex')}`;
}

function roundChannel(value: number): number {
  return Number(clamp01(value).toFixed(6));
}
