#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

import { maskOverlayModeSchema, maskOverlaySettingsSchema } from '../../../src/schemas/maskOverlaySchemas.ts';
import { evaluateMaskOverlayColor, normalizeMaskOverlaySettings } from '../../../src/utils/maskOverlayModes.ts';

const colorSchema = z
  .object({
    a: z.number().min(0).max(1),
    b: z.number().min(0).max(255),
    g: z.number().min(0).max(255),
    r: z.number().min(0).max(255),
  })
  .strict();

const looseSettingsSchema = z
  .object({
    edgeThreshold: z.number().optional(),
    mode: maskOverlayModeSchema.optional(),
    opacity: z.number().optional(),
  })
  .strict();

const fixtureSchema = z
  .object({
    expected: maskOverlaySettingsSchema,
    id: z.string().trim().min(1),
    input: looseSettingsSchema,
    samples: z
      .array(
        z
          .object({
            color: colorSchema,
            weight: z.number(),
          })
          .strict(),
      )
      .min(1),
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
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/mask-overlay-modes.json'), 'utf8')));
const invalidFixtures = z
  .array(invalidFixtureSchema)
  .min(1)
  .parse(JSON.parse(readFileSync(resolve('fixtures/masks/invalid-mask-overlay-modes.json'), 'utf8')));
const rustMaskGenerationSource = readFileSync(resolve('src-tauri/src/mask_generation.rs'), 'utf8');

for (const fixture of fixtures) {
  const actual = normalizeMaskOverlaySettings(fixture.input);
  if (JSON.stringify(actual) !== JSON.stringify(fixture.expected)) {
    console.error(`${fixture.id}: mask overlay normalization mismatch`);
    process.exit(1);
  }

  for (const sample of fixture.samples) {
    const color = evaluateMaskOverlayColor(sample.weight, actual);
    if (JSON.stringify(color) !== JSON.stringify(sample.color)) {
      console.error(`${fixture.id}: mask overlay color mismatch`);
      console.error('Expected:', JSON.stringify(sample.color));
      console.error('Actual:', JSON.stringify(color));
      process.exit(1);
    }
  }
}

for (const fixture of invalidFixtures) {
  const result = maskOverlaySettingsSchema.safeParse(fixture.payload);
  if (result.success) {
    console.error(`${fixture.id}: expected mask overlay schema rejection`);
    process.exit(1);
  }
}

const requiredRustFragments = [
  'pub enum MaskOverlayMode',
  'pub struct MaskOverlaySettings',
  'overlay_settings: Option<MaskOverlaySettings>',
  'MaskOverlayMode::Hidden',
  'MaskOverlayMode::Rubylith',
  'MaskOverlayMode::Green',
  'MaskOverlayMode::Blue',
  'MaskOverlayMode::White',
  'MaskOverlayMode::Black',
  'MaskOverlayMode::Grayscale',
  'MaskOverlayMode::Inverse',
  'MaskOverlayMode::Edges',
];

for (const fragment of requiredRustFragments) {
  if (!rustMaskGenerationSource.includes(fragment)) {
    console.error(`Missing Rust mask overlay runtime fragment: ${fragment}`);
    process.exit(1);
  }
}

console.log(`Validated ${fixtures.length} mask overlay fixtures and ${invalidFixtures.length} invalid cases.`);
