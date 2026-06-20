#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  applyFilmGrainRuntime,
  type FilmGrainRuntimePixelV1,
} from '../../../packages/rawengine-schema/src/filmGrainRuntime.ts';
import { sampleFilmGrainModelV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const FIXTURE_PATH = resolve('fixtures/film-simulation/film-grain-runtime-proof.json');
const updateFixture = process.argv.includes('--update');
const width = 18;
const height = 10;

const resultSummarySchema = z
  .object({
    afterHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    beforeHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    changedPixels: z.number().int().nonnegative(),
    metrics: z
      .object({
        averageAbsDelta: z.number().min(0),
        changedPixelRatio: z.number().min(0).max(1),
        maxAbsDelta: z.number().min(0),
      })
      .strict(),
    modelId: z.string().trim().min(1),
    provenance: z
      .object({
        algorithm: z.literal('procedural_luma_chroma_noise_v1'),
        claimBoundary: z.literal('synthetic_cpu_reference_not_measured_stock_emulation'),
        renderStage: z.literal('creative_final_after_glow'),
        seed: z.number().int().nonnegative(),
        seedPolicy: z.enum(['stable_per_image', 'stable_per_variant', 'explicit_seed', 'random_per_render']),
      })
      .strict(),
    runtimeStatus: z.literal('cpu_reference_runtime_apply_capable'),
    schemaVersion: z.literal(1),
  })
  .strict();

const proofSchema = z
  .object({
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixtureInput: z
      .object({
        colorSpace: z.literal('synthetic-display-linear-rgb'),
        kind: z.literal('synthetic-film-grain-runtime-proof'),
        scene: z.literal('shadow-midtone-highlight-ramp'),
      })
      .strict(),
    generatedFrom: z.literal('tests/integration/checks/check-film-grain-runtime-proof.ts'),
    proofId: z.literal('film.grain.runtime.cpu-reference.synthetic.v1'),
    result: resultSummarySchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.result.changedPixels <= 0) {
      context.addIssue({ code: 'custom', message: 'Film grain runtime proof must change pixels.' });
    }

    if (proof.result.metrics.maxAbsDelta <= 0 || proof.result.metrics.maxAbsDelta > 0.08) {
      context.addIssue({ code: 'custom', message: 'Film grain runtime proof max delta is outside expected bounds.' });
    }
  });

function makeSyntheticScene(): Array<FilmGrainRuntimePixelV1> {
  const pixels: Array<FilmGrainRuntimePixelV1> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ramp = x / (width - 1);
      const rowTint = y / (height - 1);
      pixels.push({
        b: roundChannel(ramp * 0.72 + rowTint * 0.08 + 0.04),
        g: roundChannel(ramp * 0.82 + (1 - rowTint) * 0.05 + 0.03),
        r: roundChannel(ramp * 0.9 + rowTint * 0.1 + 0.02),
        x,
        y,
      });
    }
  }

  return pixels;
}

const runtimeResult = applyFilmGrainRuntime(
  {
    imageId: 'synthetic-film-grain-runtime-ramp',
    pixels: makeSyntheticScene(),
    sourceContentHash: 'synthetic:shadow-midtone-highlight-ramp:v1',
    variantKey: 'preview-export-shared-seed',
  },
  sampleFilmGrainModelV1,
);
const { outputPixels: _outputPixels, ...runtimeResultSummary } = runtimeResult;

const expectedProof = proofSchema.parse({
  doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'photochemical_density_domain', 'gpu_parity'],
  fixtureInput: {
    colorSpace: 'synthetic-display-linear-rgb',
    kind: 'synthetic-film-grain-runtime-proof',
    scene: 'shadow-midtone-highlight-ramp',
  },
  generatedFrom: 'tests/integration/checks/check-film-grain-runtime-proof.ts',
  proofId: 'film.grain.runtime.cpu-reference.synthetic.v1',
  result: runtimeResultSummary,
  schemaVersion: 1,
});
const expectedJson = `${JSON.stringify(expectedProof, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, expectedJson);
  console.log('film grain runtime proof updated');
  process.exit(0);
}

const currentProof = proofSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
if (JSON.stringify(currentProof) !== JSON.stringify(expectedProof)) {
  throw new Error('Film grain runtime proof is stale. Run bun run check:film-grain-runtime-proof:update.');
}

console.log(
  `film grain runtime proof ok changed=${currentProof.result.changedPixels} maxDelta=${currentProof.result.metrics.maxAbsDelta}`,
);

function roundChannel(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}
