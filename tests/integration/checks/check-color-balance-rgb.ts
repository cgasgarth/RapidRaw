#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseColorBalanceRgbSettings } from '../../../src/schemas/colorBalanceRgbSchemas.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../../src/utils/adjustments.ts';
import { applyColorBalanceRgbToPixel } from '../../../src/utils/colorBalanceRgbRuntime.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const REPORT_PATH = 'docs/validation/color-balance-rgb-apply-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const ranges = ['shadows', 'midtones', 'highlights'];
const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();
const rgbOffsetSchema = z
  .object({
    blue: z.number().min(-1).max(1),
    green: z.number().min(-1).max(1),
    red: z.number().min(-1).max(1),
  })
  .strict();
const runtimeExpectationSchema = z
  .object({
    expectedRgb: rgbPixelSchema,
    inputRgb: rgbPixelSchema,
    tolerance: z.number().min(0).max(0.01),
  })
  .strict();
const fixtureSchema = z
  .object({
    case: z.string().min(1),
    expectedNonZeroRanges: z.array(z.string().min(1)),
    input: z.unknown(),
    runtimeExpectation: runtimeExpectationSchema.optional(),
  })
  .strict();
const reportCaseSchema = z
  .object({
    appliedOffset: rgbOffsetSchema,
    case: z.string().min(1),
    expectedNonZeroRanges: z.array(z.string().min(1)),
    inputRgb: rgbPixelSchema,
    luminance: z.number().min(0).max(1),
    maxExpectedDelta: z.number().min(0),
    maxOutputDelta: z.number().positive(),
    outputRgb: rgbPixelSchema,
    rangeWeights: z
      .object({
        highlights: z.number().min(0).max(1),
        midtones: z.number().min(0).max(1),
        shadows: z.number().min(0).max(1),
      })
      .strict(),
    runtimeStatus: z.literal('apply_runtime_proof'),
    schemaStatus: z.literal('validated_by_zod'),
    uiStatus: z.literal('existing_control_surface_not_retested'),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    fixturePath: z.literal('fixtures/color/color-balance-rgb.json'),
    issue: z.literal(1877),
    previewExportParityStatus: z.literal('covered_by_existing_gpu_path_not_retested_here'),
    schemaVersion: z.literal(1),
    validationMode: z.literal('rgb_color_balance_apply_runtime_artifact'),
  })
  .strict();
const fixtures = z.array(fixtureSchema).parse(await readJson('fixtures/color/color-balance-rgb.json'));
const invalidCases = await readJson('fixtures/color/invalid-color-balance-rgb.json');
const failures = [];
const reportCases = [];

for (const fixture of fixtures) {
  const settings = parseColorBalanceRgbSettings(fixture.input);
  const nonZeroRanges = ranges.filter((range) => Object.values(settings[range]).some((value) => value !== 0));
  for (const expectedRange of fixture.expectedNonZeroRanges) {
    if (!nonZeroRanges.includes(expectedRange)) {
      failures.push(`${fixture.case}: expected non-zero ${expectedRange} controls.`);
    }
  }

  if (fixture.runtimeExpectation) {
    const result = applyColorBalanceRgbToPixel(fixture.runtimeExpectation.inputRgb, settings);
    const outputDelta = maxRgbDelta(result.outputRgb, fixture.runtimeExpectation.inputRgb);
    const expectedDelta = maxRgbDelta(result.outputRgb, fixture.runtimeExpectation.expectedRgb);
    for (const channel of ['red', 'green', 'blue']) {
      const actual = result.outputRgb[channel];
      const expected = fixture.runtimeExpectation.expectedRgb[channel];
      if (Math.abs(actual - expected) > fixture.runtimeExpectation.tolerance) {
        failures.push(`${fixture.case}: expected ${channel}=${expected}, got ${actual}.`);
      }
    }
    if (outputDelta <= 0) {
      failures.push(`${fixture.case}: runtime output did not change the source pixel.`);
    }
    reportCases.push({
      appliedOffset: roundRgb(result.appliedOffset),
      case: fixture.case,
      expectedNonZeroRanges: fixture.expectedNonZeroRanges,
      inputRgb: fixture.runtimeExpectation.inputRgb,
      luminance: roundMetric(result.luminance),
      maxExpectedDelta: roundMetric(expectedDelta),
      maxOutputDelta: roundMetric(outputDelta),
      outputRgb: result.outputRgb,
      rangeWeights: roundRangeWeights(result.rangeWeights),
      runtimeStatus: 'apply_runtime_proof',
      schemaStatus: 'validated_by_zod',
      uiStatus: 'existing_control_surface_not_retested',
    });
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseColorBalanceRgbSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.colorBalanceRgb.enabled !== false) {
  failures.push('Initial colorBalanceRgb must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.ColorBalanceRgb))) {
  failures.push('Copy/paste color groups must include colorBalanceRgb.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.ColorBalanceRgb)) {
  failures.push('Color adjustment section must include colorBalanceRgb.');
}

const report = reportSchema.parse({
  cases: reportCases,
  fixturePath: 'fixtures/color/color-balance-rgb.json',
  issue: 1877,
  previewExportParityStatus: 'covered_by_existing_gpu_path_not_retested_here',
  schemaVersion: 1,
  validationMode: 'rgb_color_balance_apply_runtime_artifact',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-color-balance-rgb.ts --update`);
  }
}

if (failures.length > 0) {
  console.error('RGB color balance validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixtures.length} RGB color balance cases and ${invalidCases.length} invalid cases.`);

function maxRgbDelta(
  left: { blue: number; green: number; red: number },
  right: { blue: number; green: number; red: number },
) {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}

function roundRgb(value: { blue: number; green: number; red: number }) {
  return {
    blue: roundMetric(value.blue),
    green: roundMetric(value.green),
    red: roundMetric(value.red),
  };
}

function roundRangeWeights(value: { highlights: number; midtones: number; shadows: number }) {
  return {
    highlights: roundMetric(value.highlights),
    midtones: roundMetric(value.midtones),
    shadows: roundMetric(value.shadows),
  };
}
