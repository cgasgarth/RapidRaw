#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';
import { calculateSelectiveColorInfluence } from '../../../src/utils/selectiveColorFalloff.ts';
import { applySelectiveColorToRgbPixel } from '../../../src/utils/selectiveColorRuntime.ts';

const FIXTURE_PATH = 'fixtures/color/selective-color/selective-color-falloff-fixtures.json';
const REPORT_PATH = 'docs/validation/proofs/color-selective/selective-color-apply-proof-2026-06-18.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const UPDATE_REPORT = process.argv.includes('--update');

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
const reportCaseSchema = z
  .object({
    id: z.string(),
    influence: z.number().min(0).max(1),
    inputRgb: rgbPixelSchema,
    maxExpectedDelta: z.number().min(0),
    maxOutputDelta: z.number().min(0),
    outputRgb: rgbPixelSchema,
    rangeKey: z.string(),
    runtimeStatus: z.literal('apply_runtime_proof'),
    targetStatus: z.enum(['targeted_changed', 'off_target_bounded']),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    fixturePath: z.literal(FIXTURE_PATH),
    issue: z.literal(1876),
    schemaVersion: z.literal(1),
    shaderPath: z.literal(SHADER_PATH),
    validationMode: z.literal('selective_color_apply_runtime_artifact'),
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

const round = (value: number) => Number(value.toFixed(6));
const roundMetric = (value: number) => Number(value.toFixed(12));

const parseShaderDefaultSmoothness = (source: string) => {
  const functionMatch = source.match(/fn get_raw_hsl_influence\([\s\S]*?\n\}/u);
  if (!functionMatch) throw new Error('Missing WGSL get_raw_hsl_influence function.');

  const smoothnessMatch = functionMatch[0].match(/const sharpness = ([0-9.]+);/u);
  if (!smoothnessMatch) throw new Error('Missing WGSL HSL influence sharpness constant.');

  return Number(smoothnessMatch[1]);
};

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const shaderDefaultSmoothness = parseShaderDefaultSmoothness(await readFile(SHADER_PATH, 'utf8'));

const failures = [];
const reportCases = [];

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
  const maxOutputDelta = maxRgbDelta(result.outputRgb, testCase.inputRgb);
  const maxExpectedDelta = maxRgbDelta(result.outputRgb, testCase.expectedRgb);
  for (const channel of ['red', 'green', 'blue']) {
    const actual = result.outputRgb[channel];
    const expected = testCase.expectedRgb[channel];
    if (Math.abs(actual - expected) > testCase.tolerance) {
      failures.push(`${testCase.id}: expected ${channel}=${expected}, got ${actual}.`);
    }
  }
  const targetStatus = result.influence > 0 ? 'targeted_changed' : 'off_target_bounded';
  if (targetStatus === 'targeted_changed' && maxOutputDelta <= 0) {
    failures.push(`${testCase.id}: targeted selective color did not change output.`);
  }
  if (targetStatus === 'off_target_bounded' && maxOutputDelta > testCase.tolerance) {
    failures.push(`${testCase.id}: off-target selective color changed output by ${maxOutputDelta}.`);
  }
  reportCases.push({
    id: testCase.id,
    influence: roundMetric(result.influence),
    inputRgb: testCase.inputRgb,
    maxExpectedDelta: roundMetric(maxExpectedDelta),
    maxOutputDelta: roundMetric(maxOutputDelta),
    outputRgb: result.outputRgb,
    rangeKey: testCase.rangeKey,
    runtimeStatus: 'apply_runtime_proof',
    targetStatus,
  });
}

const report = reportSchema.parse({
  cases: reportCases,
  fixturePath: FIXTURE_PATH,
  issue: 1876,
  schemaVersion: 1,
  shaderPath: SHADER_PATH,
  validationMode: 'selective_color_apply_runtime_artifact',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/check-selective-color-falloff.ts --update`,
    );
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

function maxRgbDelta(
  left: { blue: number; green: number; red: number },
  right: { blue: number; green: number; red: number },
) {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}
