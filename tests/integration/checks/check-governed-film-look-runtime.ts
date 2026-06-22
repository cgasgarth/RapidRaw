#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  applyGovernedFilmLookRuntime,
  buildGovernedFilmLookCommand,
  type GovernedFilmLookPixel,
} from '../../../src/utils/governedFilmLookRuntime.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/filmLookRegistry.ts';

const FIXTURE_PATH = resolve('fixtures/film-simulation/governed-film-look-runtime.json');
const updateFixture = process.argv.includes('--update');
const WIDTH = 18;
const HEIGHT = 10;
const SOURCE_CONTENT_HASH = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const PROOF_LOOK_ID = 'film_look.generic.warm_print.v1';

const resultSummarySchema = z
  .object({
    adjustmentPatch: z.record(z.string(), z.number()),
    afterHash: z.string().trim().min(1),
    beforeHash: z.string().trim().min(1),
    changedPixelRatio: z.number().min(0).max(1),
    grainHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    halationHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    lookHash: z.string().trim().min(1),
    previewHash: z.string().trim().min(1),
    provenance: z
      .object({
        claimBoundary: z.literal('governed_creative_look_not_measured_stock_emulation'),
        colorDomain: z.literal('working_linear_rgb'),
        grainProvenanceId: z.string().trim().min(1),
        halationClaimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
        lookId: z.literal(PROOF_LOOK_ID),
        recipeId: z.literal('film_look.governed.warm_print_grain_halation.v1'),
        renderStages: z.tuple([
          z.literal('look_adjustment_patch'),
          z.literal('late_working_linear_before_output_transform'),
          z.literal('creative_final_after_glow'),
        ]),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict();

const proofSchema = z
  .object({
    commandType: z.literal('filmLook.applyGovernedRecipe'),
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixtureInput: z
      .object({
        colorSpace: z.literal('working-linear-rgb-d65'),
        kind: z.literal('synthetic-governed-film-look-runtime-proof'),
        scene: z.literal('ramp-color-chips-highlight-edge-specular'),
      })
      .strict(),
    generatedFrom: z.literal('tests/integration/checks/check-governed-film-look-runtime.ts'),
    proofId: z.literal('film.look.governed.runtime.synthetic.v1'),
    result: resultSummarySchema,
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.result.changedPixelRatio < 0.85) {
      context.addIssue({ code: 'custom', message: 'Governed film look should change most proof pixels.' });
    }

    for (const warning of [
      'grain_cpu_reference_runtime',
      'halation_creative_rgb_approximation',
      'not_measured_stock_emulation',
      'real_raw_review_required',
    ]) {
      if (!proof.result.warnings.includes(warning)) {
        context.addIssue({ code: 'custom', message: `Governed film look proof missing ${warning}.` });
      }
    }
  });

const look = FILM_LOOK_BROWSER_ITEMS.find((item) => item.id === PROOF_LOOK_ID);
if (look === undefined) {
  throw new Error(`Missing governed film look proof source: ${PROOF_LOOK_ID}`);
}

const command = buildGovernedFilmLookCommand({
  imageId: 'governed-film-look-runtime-proof',
  imagePath: '/synthetic/film/governed-film-look-runtime-proof.dng',
  look,
  operationId: 'proof_001',
  sessionId: 'governed-film-look-runtime-session',
  sourceContentHash: SOURCE_CONTENT_HASH,
  strength: 70,
  variantId: 'preview-export-shared-governed-look',
});
const runtime = applyGovernedFilmLookRuntime({
  command,
  look,
  sourcePixels: makeSyntheticScene(),
});
const { outputPixels: _outputPixels, sidecar: _sidecar, ...resultSummary } = runtime;
const proof = proofSchema.parse({
  commandType: command.commandType,
  doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'photochemical_density_domain', 'gpu_parity'],
  fixtureInput: {
    colorSpace: 'working-linear-rgb-d65',
    kind: 'synthetic-governed-film-look-runtime-proof',
    scene: 'ramp-color-chips-highlight-edge-specular',
  },
  generatedFrom: 'tests/integration/checks/check-governed-film-look-runtime.ts',
  proofId: 'film.look.governed.runtime.synthetic.v1',
  result: resultSummary,
  schemaVersion: 1,
});
const expectedJson = `${JSON.stringify(proof, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, expectedJson);
  console.log('governed film look runtime proof updated');
  process.exit(0);
}

const currentProof = proofSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
if (JSON.stringify(currentProof) !== JSON.stringify(proof)) {
  throw new Error('Governed film look runtime proof is stale. Run bun run check:governed-film-look-runtime:update.');
}

console.log(`governed film look runtime ok (${currentProof.result.changedPixelRatio} changed)`);

function makeSyntheticScene(): Array<GovernedFilmLookPixel> {
  const pixels: Array<GovernedFilmLookPixel> = [];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ramp = x / (WIDTH - 1);
      const chip = y % 3;
      const specular = (x - 13) ** 2 + (y - 3) ** 2 <= 4;
      const edgeBoost = x >= WIDTH - 4 && y >= 2 && y <= HEIGHT - 3 ? 0.28 : 0;
      pixels.push({
        b: roundChannel(ramp * 0.68 + (chip === 2 ? 0.18 : 0.04) + edgeBoost + (specular ? 0.72 : 0)),
        g: roundChannel(ramp * 0.78 + (chip === 1 ? 0.17 : 0.03) + edgeBoost + (specular ? 0.88 : 0)),
        r: roundChannel(ramp * 0.9 + (chip === 0 ? 0.22 : 0.02) + edgeBoost + (specular ? 1.05 : 0)),
        x,
        y,
      });
    }
  }

  return pixels;
}

function roundChannel(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}
