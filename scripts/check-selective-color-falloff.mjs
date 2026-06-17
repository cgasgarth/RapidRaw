#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { applySelectiveColorToRgbPixel } from '../src/utils/selectiveColorRuntime.ts';
import { calculateSelectiveColorInfluence } from '../src/utils/selectiveColorFalloff.ts';

const FIXTURE_PATH = 'fixtures/color/selective-color-falloff-fixtures.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';

const falloffCaseSchema = z
  .object({
    centerHueDegrees: z.number().min(0).lt(360),
    expectedInfluence: z.number().min(0).max(1),
    hueDegrees: z.number().min(0).lt(360),
    id: z.string().regex(/^color\.selective\.falloff\.[a-z0-9.-]+\.v[0-9]+$/u),
    smoothness: z.number().positive().max(8),
    tolerance: z.number().positive().max(0.001),
    widthDegrees: z.number().positive().max(180),
  })
  .strict();

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const runtimeCaseSchema = z
  .object({
    adjustment: z
      .object({
        hue: z.number().min(-180).max(180),
        luminance: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
      })
      .strict(),
    expectedRgb: rgbPixelSchema,
    id: z.string().regex(/^color\.selective\.runtime\.[a-z0-9.-]+\.v[0-9]+$/u),
    inputRgb: rgbPixelSchema,
    rangeKey: z.enum(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas']),
    tolerance: z.number().positive().max(0.001),
  })
  .strict();

const manifestSchema = z
  .object({
    $schema: z.string().url(),
    cases: z.array(falloffCaseSchema).min(1),
    issue: z.literal(97),
    runtimeCases: z.array(runtimeCaseSchema).optional(),
    schemaVersion: z.literal(1),
    shaderDefaultSmoothness: z.number().positive(),
    snapshotDate: z.string().date(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = manifest.cases.map((testCase) => testCase.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Falloff case IDs must be unique.', path: ['cases'] });
    }
  });

const round = (value) => Number(value.toFixed(6));

const parseShaderDefaultSmoothness = (source) => {
  const functionMatch = source.match(/fn get_raw_hsl_influence\([\s\S]*?\n\}/u);
  if (!functionMatch) throw new Error('Missing WGSL get_raw_hsl_influence function.');

  const smoothnessMatch = functionMatch[0].match(/const sharpness = ([0-9.]+);/u);
  if (!smoothnessMatch) throw new Error('Missing WGSL HSL influence sharpness constant.');

  return Number(smoothnessMatch[1]);
};

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const shaderDefaultSmoothness = parseShaderDefaultSmoothness(await readFile(SHADER_PATH, 'utf8'));

const failures = [];

if (shaderDefaultSmoothness !== manifest.shaderDefaultSmoothness) {
  failures.push(`WGSL default smoothness ${shaderDefaultSmoothness} does not match fixture.`);
}

for (const testCase of manifest.cases) {
  const actual = round(
    calculateSelectiveColorInfluence({
      centerHueDegrees: testCase.centerHueDegrees,
      hueDegrees: testCase.hueDegrees,
      smoothness: testCase.smoothness,
      widthDegrees: testCase.widthDegrees,
    }),
  );
  const delta = Math.abs(actual - testCase.expectedInfluence);
  if (delta > testCase.tolerance) {
    failures.push(`${testCase.id}: expected ${testCase.expectedInfluence}, got ${actual}.`);
  }
}

for (const testCase of manifest.runtimeCases ?? []) {
  const result = applySelectiveColorToRgbPixel(testCase.inputRgb, testCase.rangeKey, testCase.adjustment);
  for (const channel of ['red', 'green', 'blue']) {
    const actual = result.outputRgb[channel];
    const expected = testCase.expectedRgb[channel];
    if (Math.abs(actual - expected) > testCase.tolerance) {
      failures.push(`${testCase.id}: expected ${channel}=${expected}, got ${actual}.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Selective color falloff validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Validated ${manifest.cases.length} selective color falloff cases and ${manifest.runtimeCases?.length ?? 0} runtime cases.`,
);
