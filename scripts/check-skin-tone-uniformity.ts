#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { applySkinToneUniformity, applySkinToneUniformityToRgbPixel } from '../src/utils/skinToneUniformity.ts';

const FIXTURE_PATH = 'fixtures/color/skin-tone-uniformity-fixtures.json';

const skinPatchSchema = z
  .object({
    hueDegrees: z.number().min(0).lt(360),
    luminance: z.number().min(0).max(1),
    saturation: z.number().min(0).max(1),
  })
  .strict();

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const settingsSchema = z
  .object({
    hueUniformity: z.number().min(0).max(1),
    luminanceUniformity: z.number().min(0).max(1),
    saturationUniformity: z.number().min(0).max(1),
    targetHueDegrees: z.number().min(0).lt(360),
    targetLuminance: z.number().min(0).max(1),
    targetSaturation: z.number().min(0).max(1),
  })
  .strict();

const caseSchema = z
  .object({
    expected: skinPatchSchema,
    expectedRgb: rgbPixelSchema.optional(),
    id: z.string().regex(/^color\.skin\.[a-z0-9.-]+\.v[0-9]+$/u),
    input: skinPatchSchema,
    inputRgb: rgbPixelSchema.optional(),
    settings: settingsSchema,
    tolerance: z.number().positive().max(0.001),
  })
  .strict();

const manifestSchema = z
  .object({
    $schema: z.string().url(),
    cases: z.array(caseSchema).min(1),
    issue: z.literal(98),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.cases.map((testCase) => testCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Skin-tone case IDs must be unique.', path: ['cases'] });
    }
  });

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const fields = ['hueDegrees', 'saturation', 'luminance'];
const failures = [];

for (const testCase of manifest.cases) {
  const actual = applySkinToneUniformity(testCase.input, testCase.settings);
  for (const field of fields) {
    const delta = Math.abs(actual[field] - testCase.expected[field]);
    if (delta > testCase.tolerance) {
      failures.push(`${testCase.id}.${field}: expected ${testCase.expected[field]}, got ${actual[field]}.`);
    }
  }

  if (testCase.inputRgb && testCase.expectedRgb) {
    const rgbActual = applySkinToneUniformityToRgbPixel(testCase.inputRgb, testCase.settings);
    for (const channel of ['red', 'green', 'blue']) {
      const delta = Math.abs(rgbActual.outputRgb[channel] - testCase.expectedRgb[channel]);
      if (delta > testCase.tolerance) {
        failures.push(
          `${testCase.id}.rgb.${channel}: expected ${testCase.expectedRgb[channel]}, got ${rgbActual.outputRgb[channel]}.`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('Skin-tone uniformity validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${manifest.cases.length} skin-tone uniformity fixture cases.`);
