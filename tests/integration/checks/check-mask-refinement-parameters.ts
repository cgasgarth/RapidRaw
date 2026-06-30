#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { maskRefinementParametersSchema } from '../../../src/schemas/maskParameterSchemas.ts';
import {
  evaluateMaskRefinementWeight,
  normalizeMaskRefinementParameters,
} from '../../../src/utils/mask/maskRefinement.ts';

const looseParametersSchema = z
  .object({
    density: z.number().optional(),
    edgeContrast: z.number().optional(),
    edgeShiftPx: z.number().optional(),
    featherPx: z.number().optional(),
    hairDetail: z.number().optional(),
    smoothness: z.number().optional(),
  })
  .strict();

const sampleSchema = z
  .object({
    baseWeight: z.number(),
    edgeDistancePx: z.number(),
    weight: z.number().min(0).max(1),
  })
  .strict();

const fixtureSchema = z
  .object({
    expected: maskRefinementParametersSchema,
    id: z.string().trim().min(1),
    input: looseParametersSchema,
    samples: z.array(sampleSchema).min(1),
  })
  .strict();

const invalidFixtureSchema = z
  .object({
    id: z.string().trim().min(1),
    payload: z.unknown(),
  })
  .strict();

const fixtures = z
  .array(fixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/render/mask-refinement-parameters.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid/invalid-mask-refinement-parameters.json'), 'utf8')));
const rustMaskGenerationSource = readFileSync(resolve('src-tauri/src/mask_generation.rs'), 'utf8');

for (const fixture of fixtures) {
  const actual = normalizeMaskRefinementParameters(fixture.input);
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: mask refinement normalization mismatch`);
    console.error('Expected:', JSON.stringify(fixture.expected, null, 2));
    console.error('Actual:', JSON.stringify(actual, null, 2));
    process.exit(1);
  }

  for (const sample of fixture.samples) {
    const actualWeight = evaluateMaskRefinementWeight(sample.baseWeight, sample.edgeDistancePx, actual);
    if (Math.abs(actualWeight - sample.weight) > 0.000001) {
      console.error(`${fixture.id}: expected refined weight ${sample.weight}, got ${actualWeight}`);
      process.exit(1);
    }
  }
}

for (const fixture of invalidFixtures) {
  const result = maskRefinementParametersSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected mask refinement schema rejection`);
    process.exit(1);
  }
}

const requiredRustFragments = [
  'pub struct MaskRefinementParameters',
  'fn apply_mask_refinement',
  'edge_shift_px',
  'feather_px',
  'hair_detail',
  'grayscale_dilate',
  'grayscale_erode',
  'apply_mask_refinement(mask, &sub_mask.parameters, scale, warped_image)',
];

for (const fragment of requiredRustFragments) {
  if (!rustMaskGenerationSource.includes(fragment)) {
    console.error(`Missing Rust mask refinement runtime fragment: ${fragment}`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} mask refinement fixtures and ${invalidFixtures.length} invalid cases.`);
