#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';
import { buildFilmLookAppliedAdjustmentPatch } from '../../../../src/utils/film-look/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../../src/utils/film-look/filmLookRegistry.ts';
import {
  applyGovernedFilmLookRuntime,
  buildGovernedFilmLookCommand,
  type GovernedFilmLookPixel,
} from '../../../../src/utils/governedFilmLookRuntime.ts';

const FIXTURE_PATH = resolve('fixtures/film-simulation/governed-film-look-runtime.json');
const DOCS_PROOF_PATH = resolve(
  'docs/validation/proofs/film-look/governed-film-look-runtime-preview-export-2026-07-02.json',
);
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
        coordinatePolicy: z.literal('variant_pixel_stable_v1'),
        grain: z
          .object({
            controls: z
              .object({
                amount: z.number().min(0).max(100),
                roughness: z.number().min(0).max(100),
                size: z.number().min(0).max(100),
              })
              .strict(),
            provenanceId: z.string().trim().min(1),
            renderStage: z.literal('creative_final_after_glow'),
            seed: z.number().int().nonnegative(),
            seedPolicy: z.enum(['stable_per_image', 'stable_per_variant', 'explicit_seed', 'random_per_render']),
          })
          .strict(),
        grainProvenanceId: z.string().trim().min(1),
        halation: z
          .object({
            claimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
            controls: z
              .object({
                amount: z.number().min(0).max(100),
                enabled: z.boolean(),
                highlightThresholdEv: z.number().min(0.5).max(6),
                sigmaShortEdgeFraction: z.number().min(0).max(0.01),
                warmth: z.number().min(0).max(0.75),
              })
              .strict(),
            renderStage: z.literal('late_working_linear_before_output_transform'),
          })
          .strict(),
        halationClaimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
        lookId: z.literal(PROOF_LOOK_ID),
        recipeId: z.literal('film_look.governed.warm_print_grain_halation.v1'),
        renderStages: z.tuple([
          z.literal('look_adjustment_patch'),
          z.literal('late_working_linear_before_output_transform'),
          z.literal('creative_final_after_glow'),
        ]),
        sourceContentHash: z.literal(SOURCE_CONTENT_HASH),
        variantId: z.literal('preview-export-shared-governed-look'),
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
    generatedFrom: z.literal('tests/integration/checks/film/check-governed-film-look-runtime.ts'),
    proofId: z.literal('film.look.governed.runtime.synthetic.v1'),
    result: resultSummarySchema,
    schemaVersion: z.literal(1),
    sensitivity: z
      .object({
        grainAmountAfterHash: z.string().trim().min(1),
        grainAmountGrainHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
        halationAmountAfterHash: z.string().trim().min(1),
        halationAmountHalationHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
        repeatAfterHash: z.string().trim().min(1),
      })
      .strict(),
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

    if (proof.sensitivity.repeatAfterHash !== proof.result.afterHash) {
      context.addIssue({ code: 'custom', message: 'Governed film look repeat run changed the output hash.' });
    }

    if (
      proof.sensitivity.grainAmountAfterHash === proof.result.afterHash ||
      proof.sensitivity.grainAmountGrainHash === proof.result.grainHash
    ) {
      context.addIssue({ code: 'custom', message: 'Governed film look grain control did not change output.' });
    }

    if (
      proof.sensitivity.halationAmountAfterHash === proof.result.afterHash ||
      proof.sensitivity.halationAmountHalationHash === proof.result.halationHash
    ) {
      context.addIssue({ code: 'custom', message: 'Governed film look halation control did not change output.' });
    }
  });

const look = FILM_LOOK_BROWSER_ITEMS.find((item) => item.id === PROOF_LOOK_ID);
if (look === undefined) {
  throw new Error(`Missing governed film look proof source: ${PROOF_LOOK_ID}`);
}

const command = buildProofCommand();
const runtime = applyProofRuntime(command);
const repeatRuntime = applyProofRuntime(command);
const grainAmountRuntime = applyProofRuntime(
  buildProofCommand({
    grain: {
      amount: 44,
    },
  }),
);
const halationAmountRuntime = applyProofRuntime(
  buildProofCommand({
    halation: {
      amount: 12,
    },
  }),
);
const { outputPixels: _outputPixels, sidecar: _sidecar, ...resultSummary } = runtime;
const proof = proofSchema.parse({
  commandType: command.commandType,
  doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'photochemical_density_domain', 'gpu_parity'],
  fixtureInput: {
    colorSpace: 'working-linear-rgb-d65',
    kind: 'synthetic-governed-film-look-runtime-proof',
    scene: 'ramp-color-chips-highlight-edge-specular',
  },
  generatedFrom: 'tests/integration/checks/film/check-governed-film-look-runtime.ts',
  proofId: 'film.look.governed.runtime.synthetic.v1',
  result: resultSummary,
  schemaVersion: 1,
  sensitivity: {
    grainAmountAfterHash: grainAmountRuntime.afterHash,
    grainAmountGrainHash: grainAmountRuntime.grainHash,
    halationAmountAfterHash: halationAmountRuntime.afterHash,
    halationAmountHalationHash: halationAmountRuntime.halationHash,
    repeatAfterHash: repeatRuntime.afterHash,
  },
});
const docsProof = {
  ...proof,
  proofLevel: 'synthetic_runtime_output_with_normalized_payload_cases',
  proofLimits: proof.doesNotProve,
  normalizedStrengthCases: [25, 65, 100].map((strength) => ({
    adjustmentPatch: buildFilmLookAppliedAdjustmentPatch(look, strength),
    strength,
  })),
};
const expectedJson = `${JSON.stringify(proof, null, 2)}\n`;
const expectedDocsJson = `${JSON.stringify(docsProof, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await mkdir(dirname(DOCS_PROOF_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, expectedJson);
  await writeFile(DOCS_PROOF_PATH, expectedDocsJson);
  console.log('governed film look runtime proof updated');
  process.exit(0);
}

const currentProof = proofSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
if (JSON.stringify(currentProof) !== JSON.stringify(proof)) {
  throw new Error('Governed film look runtime proof is stale. Run bun run check:governed-film-look-runtime:update.');
}

const currentDocsProof = JSON.parse(await readFile(DOCS_PROOF_PATH, 'utf8'));
if (JSON.stringify(currentDocsProof) !== JSON.stringify(docsProof)) {
  throw new Error('Governed film look docs proof is stale. Run bun run check:governed-film-look-runtime:update.');
}

console.log(`governed film look runtime ok (${currentProof.result.changedPixelRatio} changed)`);

function buildProofCommand(recipe?: Parameters<typeof buildGovernedFilmLookCommand>[0]['recipe']) {
  return buildGovernedFilmLookCommand({
    imageId: 'governed-film-look-runtime-proof',
    imagePath: '/synthetic/film/governed-film-look-runtime-proof.dng',
    look,
    operationId: 'proof_001',
    recipe,
    sessionId: 'governed-film-look-runtime-session',
    sourceContentHash: SOURCE_CONTENT_HASH,
    strength: 70,
    variantId: 'preview-export-shared-governed-look',
  });
}

function applyProofRuntime(commandValue: ReturnType<typeof buildGovernedFilmLookCommand>) {
  return applyGovernedFilmLookRuntime({
    command: commandValue,
    look,
    sourcePixels: makeSyntheticScene(),
  });
}

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
