#!/usr/bin/env bun

import { readFile, writeFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  applySkinToneUniformity,
  applySkinToneUniformityToRgbPixel,
} from '../../../../src/utils/skinToneUniformity.ts';

const FIXTURE_PATH = 'fixtures/color/proofs/hue-memory-color-gate.json';
const REPORT_PATH = 'docs/validation/proofs/color/color-hue-memory-gate-2026-06-18.json';
const UPDATE_REPORT = process.argv.includes('--update');
const MAX_NEUTRAL_RGB_DRIFT = 1e-12;

const patchSchema = z
  .object({
    hueDegrees: z.number().min(0).lt(360),
    luminance: z.number().min(0).max(1),
    saturation: z.number().min(0).max(1),
  })
  .strict();
const rgbSchema = z
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
    expected: patchSchema,
    expectedRgb: rgbSchema.optional(),
    id: z.string().regex(/^color\.(hue|neutral|memory)\.[a-z0-9.-]+\.v[0-9]+$/u),
    input: patchSchema,
    inputRgb: rgbSchema.optional(),
    kind: z.enum(['hue_linearity', 'memory_color', 'neutral_drift']),
    settings: settingsSchema,
    tolerance: z.number().positive().max(0.001),
  })
  .strict()
  .superRefine((testCase, context) => {
    if (testCase.kind === 'neutral_drift' && (testCase.inputRgb === undefined || testCase.expectedRgb === undefined)) {
      context.addIssue({ code: 'custom', message: 'Neutral drift cases require RGB fixtures.', path: ['inputRgb'] });
    }
  });
const manifestSchema = z
  .object({
    $schema: z.url(),
    cases: z.array(caseSchema).min(1),
    issue: z.literal(1932),
    schemaVersion: z.literal(1),
    snapshotDate: z.iso.date(),
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const failures: Array<string> = [];
const reportCases = [];

for (const testCase of manifest.cases) {
  const actual = applySkinToneUniformity(testCase.input, testCase.settings);
  const hueError = angularDistance(actual.hueDegrees, testCase.expected.hueDegrees);
  const saturationError = Math.abs(actual.saturation - testCase.expected.saturation);
  const luminanceError = Math.abs(actual.luminance - testCase.expected.luminance);
  const maxHslError = Math.max(hueError, saturationError, luminanceError);

  if (maxHslError > testCase.tolerance) {
    failures.push(`${testCase.id}: HSL error ${maxHslError} exceeds ${testCase.tolerance}`);
  }

  const targetDistanceBefore = memoryColorDistance(testCase.input, testCase.settings);
  const targetDistanceAfter = memoryColorDistance(actual, testCase.settings);
  if (testCase.kind === 'memory_color' && targetDistanceAfter >= targetDistanceBefore) {
    failures.push(`${testCase.id}: memory-color adjustment did not move toward target.`);
  }

  let neutralRgbDrift = 0;
  if (testCase.inputRgb !== undefined && testCase.expectedRgb !== undefined) {
    const rgbActual = applySkinToneUniformityToRgbPixel(testCase.inputRgb, testCase.settings);
    neutralRgbDrift = maxRgbDelta(rgbActual.outputRgb, testCase.expectedRgb);
    if (neutralRgbDrift > testCase.tolerance) {
      failures.push(`${testCase.id}: RGB drift ${neutralRgbDrift} exceeds ${testCase.tolerance}`);
    }
    if (testCase.kind === 'neutral_drift' && neutralRgbDrift > MAX_NEUTRAL_RGB_DRIFT) {
      failures.push(`${testCase.id}: neutral RGB drift ${neutralRgbDrift} exceeds ${MAX_NEUTRAL_RGB_DRIFT}`);
    }
  }

  reportCases.push({
    hueErrorDegrees: roundMetric(hueError),
    id: testCase.id,
    kind: testCase.kind,
    luminanceError: roundMetric(luminanceError),
    neutralRgbDrift: roundMetric(neutralRgbDrift),
    saturationError: roundMetric(saturationError),
    targetDistanceAfter: roundMetric(targetDistanceAfter),
    targetDistanceBefore: roundMetric(targetDistanceBefore),
  });
}

const kinds = new Set(manifest.cases.map((testCase) => testCase.kind));
for (const requiredKind of ['hue_linearity', 'memory_color', 'neutral_drift']) {
  if (!kinds.has(requiredKind)) failures.push(`Missing ${requiredKind} case.`);
}

const report = {
  cases: reportCases,
  fixturePath: FIXTURE_PATH,
  generatedFromSnapshotDate: manifest.snapshotDate,
  issue: 1932,
  schemaVersion: 1,
  thresholds: {
    maxNeutralRgbDrift: MAX_NEUTRAL_RGB_DRIFT,
    perCaseToleranceMax: 0.001,
  },
};
const reportText = `${JSON.stringify(report, null, 2)}\n`;
if (UPDATE_REPORT) {
  await writeFile(REPORT_PATH, reportText);
} else {
  const expectedReport = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  if (JSON.stringify(expectedReport) !== JSON.stringify(report)) {
    failures.push(
      `${REPORT_PATH} is stale; run bun tests/integration/checks/color/check-hue-memory-color-gate.ts --update`,
    );
  }
}

if (failures.length > 0) {
  console.error('Hue/memory color gate failed:');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log(`hue memory color gate ok (${manifest.cases.length} cases)`);

function angularDistance(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function memoryColorDistance(
  patch: { hueDegrees: number; luminance: number; saturation: number },
  settings: { targetHueDegrees: number; targetLuminance: number; targetSaturation: number },
): number {
  return (
    angularDistance(patch.hueDegrees, settings.targetHueDegrees) / 180 +
    Math.abs(patch.luminance - settings.targetLuminance) +
    Math.abs(patch.saturation - settings.targetSaturation)
  );
}

function maxRgbDelta(
  left: { blue: number; green: number; red: number },
  right: { blue: number; green: number; red: number },
): number {
  return Math.max(Math.abs(left.red - right.red), Math.abs(left.green - right.green), Math.abs(left.blue - right.blue));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(12));
}
