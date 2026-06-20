#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import { parseBlackWhiteMixerSettings } from '../../../src/schemas/blackWhiteMixerSchemas.ts';
import { applyBlackWhiteMixerToRgbPixel } from '../../../src/utils/blackWhiteMixerRuntime.ts';
import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_SECTIONS,
  ColorAdjustment,
  INITIAL_ADJUSTMENTS,
} from '../../../src/utils/adjustments.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const REPORT_PATH = 'docs/validation/black-white-mixer-apply-proof-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');

const rgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
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
    expectedActiveChannels: z.array(z.string().min(1)),
    input: z.unknown(),
    runtimeExpectation: runtimeExpectationSchema.optional(),
  })
  .strict();
const reportCaseSchema = z
  .object({
    case: z.string().min(1),
    expectedActiveChannels: z.array(z.string().min(1)),
    influence: z.record(z.string(), z.number().min(0).max(1)),
    inputRgb: rgbPixelSchema,
    maxExpectedDelta: z.number().min(0),
    maxOutputDelta: z.number().positive(),
    outputRgb: rgbPixelSchema,
    runtimeStatus: z.literal('apply_runtime_proof'),
    schemaStatus: z.literal('validated_by_zod'),
    uiStatus: z.literal('existing_control_surface_not_retested'),
    weightedAdjustment: z.number(),
  })
  .strict();
const reportSchema = z
  .object({
    cases: z.array(reportCaseSchema).min(1),
    fixturePath: z.literal('fixtures/color/black-white-mixer.json'),
    issue: z.literal(1878),
    schemaVersion: z.literal(1),
    validationMode: z.literal('black_white_mixer_apply_runtime_artifact'),
  })
  .strict();

const fixtures = z.array(fixtureSchema).parse(await readJson('fixtures/color/black-white-mixer.json'));
const invalidCases = await readJson('fixtures/color/invalid-black-white-mixer.json');
const failures = [];
const reportCases = [];

for (const fixture of fixtures) {
  const settings = parseBlackWhiteMixerSettings(fixture.input);
  const positiveChannels = Object.entries(settings.weights)
    .filter(([, value]) => value > 0)
    .map(([channel]) => channel);
  for (const expectedChannel of fixture.expectedActiveChannels) {
    if (!positiveChannels.includes(expectedChannel)) {
      failures.push(`${fixture.case}: expected positive ${expectedChannel} contribution.`);
    }
  }

  if (fixture.runtimeExpectation) {
    const result = applyBlackWhiteMixerToRgbPixel(fixture.runtimeExpectation.inputRgb, settings);
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
      case: fixture.case,
      expectedActiveChannels: fixture.expectedActiveChannels,
      influence: result.influence,
      inputRgb: fixture.runtimeExpectation.inputRgb,
      maxExpectedDelta: roundMetric(expectedDelta),
      maxOutputDelta: roundMetric(outputDelta),
      outputRgb: result.outputRgb,
      runtimeStatus: 'apply_runtime_proof',
      schemaStatus: 'validated_by_zod',
      uiStatus: 'existing_control_surface_not_retested',
      weightedAdjustment: roundMetric(result.weightedAdjustment),
    });
  }
}

for (const invalidCase of invalidCases) {
  try {
    parseBlackWhiteMixerSettings(invalidCase.input);
    failures.push(`${invalidCase.case}: expected invalid settings to fail.`);
  } catch (_error) {
    // Expected invalid fixture.
  }
}

if (INITIAL_ADJUSTMENTS.blackWhiteMixer.enabled !== false) {
  failures.push('Initial blackWhiteMixer must be disabled.');
}

if (!ADJUSTMENT_GROUPS['color']?.some((group) => group.keys.includes(ColorAdjustment.BlackWhiteMixer))) {
  failures.push('Copy/paste color groups must include blackWhiteMixer.');
}

if (!ADJUSTMENT_SECTIONS.color.includes(ColorAdjustment.BlackWhiteMixer)) {
  failures.push('Color adjustment section must include blackWhiteMixer.');
}

const report = reportSchema.parse({
  cases: reportCases,
  fixturePath: 'fixtures/color/black-white-mixer.json',
  issue: 1878,
  schemaVersion: 1,
  validationMode: 'black_white_mixer_apply_runtime_artifact',
});
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = reportSchema.parse(JSON.parse(await readFile(REPORT_PATH, 'utf8')));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(`${REPORT_PATH} is stale; run bun tests/integration/checks/check-black-white-mixer.ts --update`);
  }
}

if (failures.length > 0) {
  console.error('Black and white mixer validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${fixtures.length} black and white mixer cases and ${invalidCases.length} invalid cases.`);

function maxRgbDelta(
  left: { blue: number; green: number; red: number },
  right: { blue: number; green: number; red: number },
) {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
