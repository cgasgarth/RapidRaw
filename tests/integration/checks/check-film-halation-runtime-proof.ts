#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  applyFilmHalationRuntime,
  filmHalationMaskSampleV1Schema,
  type FilmHalationPixelV1,
  filmHalationRuntimeResultV1Schema,
} from '../../../packages/rawengine-schema/src/filmHalationRuntime.ts';

const FIXTURE_PATH = resolve('fixtures/film-simulation/film-halation-runtime-proof.json');
const updateFixture = process.argv.includes('--update');
const width = 18;
const height = 10;

const proofSchema = z
  .object({
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixtureInput: z
      .object({
        colorSpace: z.literal('working-linear-rgb-d65'),
        kind: z.literal('synthetic-film-halation-runtime-proof'),
        scene: z.literal('specular-discs-edges-ramps-neutral-control'),
      })
      .strict(),
    generatedFrom: z.literal('tests/integration/checks/check-film-halation-runtime-proof.ts'),
    proofId: z.literal('film.halation.conservative.runtime.synthetic.v1'),
    result: filmHalationRuntimeResultV1Schema.omit({ maskSamples: true, outputPixels: true }).extend({
      representativeMaskSamples: z.array(filmHalationMaskSampleV1Schema).min(8).max(12),
    }),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((proof, context) => {
    if (proof.result.provenance.algorithmId !== 'halation.conservative.v1') {
      context.addIssue({ code: 'custom', message: 'Halation proof must use the conservative algorithm.' });
    }
    if (proof.result.changedPixels <= 0) {
      context.addIssue({ code: 'custom', message: 'Halation runtime proof must change pixels.' });
    }
    if (proof.result.metrics.maxAbsDelta <= 0 || proof.result.metrics.maxAbsDelta > 0.18) {
      context.addIssue({ code: 'custom', message: 'Halation max delta is outside conservative bounds.' });
    }
    if (proof.result.claimBoundary !== 'rgb_creative_approximation_not_physical_film_halation') {
      context.addIssue({ code: 'custom', message: 'Halation proof must keep the non-physical claim boundary.' });
    }
    if (!proof.result.warnings.includes('HALATION_PARAMETERS_OUTSIDE_VALIDATED_RANGE')) {
      context.addIssue({ code: 'custom', message: 'Max validated case must surface parameter warning.' });
    }
  });

const defaultResult = applyFilmHalationRuntime({
  controls: {
    amount: 30,
    enabled: true,
    highlightThresholdEv: 2.25,
    sigmaShortEdgeFraction: 0.0012,
    warmth: 0.45,
  },
  fullResShortEdgePx: 1200,
  imageId: 'synthetic-halation-specular-disc',
  pixels: makeSyntheticScene(),
  previewShortEdgePx: 800,
  sourceContentHash: 'synthetic:halation-specular-disc:v1',
  workingSpace: 'linear_srgb_d65',
});

const maxValidatedResult = applyFilmHalationRuntime({
  controls: {
    amount: 100,
    enabled: true,
    highlightThresholdEv: 1.5,
    sigmaShortEdgeFraction: 0.004,
    warmth: 0.6,
  },
  fullResShortEdgePx: 1200,
  imageId: 'synthetic-halation-max-validated',
  pixels: makeSyntheticScene(),
  sourceContentHash: 'synthetic:halation-specular-disc:v1',
  workingSpace: 'linear_srgb_d65',
});

const disabledResult = applyFilmHalationRuntime({
  controls: {
    amount: 0,
    enabled: false,
    highlightThresholdEv: 2.25,
    sigmaShortEdgeFraction: 0.0012,
    warmth: 0.45,
  },
  fullResShortEdgePx: 1200,
  imageId: 'synthetic-halation-disabled-control',
  pixels: makeSyntheticScene(),
  sourceContentHash: 'synthetic:halation-specular-disc:v1',
  workingSpace: 'linear_srgb_d65',
});

if (disabledResult.changedPixels !== 0 || disabledResult.beforeHash !== disabledResult.afterHash) {
  throw new Error('Disabled halation control must leave pixels unchanged.');
}
if (defaultResult.previewApproximation !== false) {
  throw new Error('Default preview sigma should be large enough to avoid previewApproximation.');
}
if (!defaultResult.maskSamples.some((sample) => sample.highlight > 0 && sample.quantity === 0)) {
  throw new Error('Halation mask should protect source highlights from self-addition.');
}
if (!maxValidatedResult.warnings.includes('HALATION_PARAMETERS_OUTSIDE_VALIDATED_RANGE')) {
  throw new Error('High amount case must warn outside validated default range.');
}

const { maskSamples: maxValidatedMaskSamples, outputPixels: _outputPixels, ...resultSummary } = maxValidatedResult;
const expectedProof = proofSchema.parse({
  doesNotProve: [
    'physical_film_halation',
    'measured_stock_behavior',
    'spectral_emulsion_model',
    'real_raw_quality',
    'gpu_parity',
    'ui_e2e',
  ],
  fixtureInput: {
    colorSpace: 'working-linear-rgb-d65',
    kind: 'synthetic-film-halation-runtime-proof',
    scene: 'specular-discs-edges-ramps-neutral-control',
  },
  generatedFrom: 'tests/integration/checks/check-film-halation-runtime-proof.ts',
  proofId: 'film.halation.conservative.runtime.synthetic.v1',
  result: {
    ...resultSummary,
    representativeMaskSamples: selectRepresentativeMaskSamples(maxValidatedMaskSamples),
  },
  schemaVersion: 1,
});
const expectedJson = `${JSON.stringify(expectedProof, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, expectedJson);
  console.log('film halation runtime proof updated');
  process.exit(0);
}

const currentProof = proofSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
if (JSON.stringify(currentProof) !== JSON.stringify(expectedProof)) {
  throw new Error('Film halation runtime proof is stale. Run bun run check:film-halation-runtime-proof:update.');
}

console.log(
  `film halation runtime proof ok changed=${currentProof.result.changedPixels} maxDelta=${currentProof.result.metrics.maxAbsDelta}`,
);

function makeSyntheticScene(): Array<FilmHalationPixelV1> {
  const pixels: Array<FilmHalationPixelV1> = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ramp = x / (width - 1);
      const neutral = y >= 6 && y <= 7 && x >= 2 && x <= 5;
      const specularDisc = (x - 7) ** 2 + (y - 3) ** 2 <= 4;
      const edgeLight = x >= width - 3 && y >= 1 && y <= 8;
      const denseSmallLight = (x + y) % 7 === 0 && y <= 4;
      const base = neutral ? 0.22 : ramp * 0.54 + 0.04;
      const highlightBoost = specularDisc ? 1.45 : edgeLight ? 0.9 : denseSmallLight ? 0.7 : 0;
      pixels.push({
        b: roundChannel(base * 0.82 + highlightBoost * 0.72 + (y % 3 === 0 ? 0.04 : 0)),
        g: roundChannel(base * 0.96 + highlightBoost * 0.88),
        r: roundChannel(base + highlightBoost),
        x,
        y,
      });
    }
  }

  return pixels;
}

function selectRepresentativeMaskSamples(
  samples: Array<z.infer<typeof filmHalationMaskSampleV1Schema>>,
): Array<z.infer<typeof filmHalationMaskSampleV1Schema>> {
  return samples
    .filter((sample) => {
      const onEdge = sample.x === 0 || sample.y === 0 || sample.x === width - 1 || sample.y === height - 1;
      const strongHighlight = sample.highlight > 0.9;
      const haloOnly = sample.highlight === 0 && sample.quantity > 0.1;
      const protectedSource = sample.highlight > 0.4 && sample.quantity < 0.08;
      return onEdge || strongHighlight || haloOnly || protectedSource;
    })
    .slice(0, 12);
}

function roundChannel(value: number): number {
  return Number(Math.min(4, Math.max(0, value)).toFixed(6));
}
