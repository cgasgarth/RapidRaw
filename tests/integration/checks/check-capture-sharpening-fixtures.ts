#!/usr/bin/env bun

import { z } from 'zod';

import { expectInvalidCases, finishFixtureCheck, readJson } from '../../../scripts/lib/fixtures/fixture-checks.ts';
import {
  captureSharpeningPresetSchema,
  estimateCaptureSharpeningKernelDiameter,
  parseCaptureSharpeningPreset,
} from '../../../src/schemas/captureSharpeningSchemas.ts';

const invalidCaseSchema = z.object({ case: z.string().min(1), preset: z.unknown() }).strict();

const presets = z
  .array(z.unknown())
  .parse(await readJson('fixtures/detail/sharpening/capture-sharpening-presets.json'));
const invalidCases = z
  .array(invalidCaseSchema)
  .parse(await readJson('fixtures/detail/invalid/sharpening/invalid-capture-sharpening-presets.json'));
const failures: string[] = [];

let totalKernelDiameter = 0;

for (const presetValue of presets) {
  const preset = parseCaptureSharpeningPreset(presetValue);
  totalKernelDiameter += estimateCaptureSharpeningKernelDiameter(preset);
}

expectInvalidCases({
  failures,
  getPayload: (invalidCase) => invalidCase.preset,
  invalidCases,
  label: 'capture sharpening preset',
  schema: captureSharpeningPresetSchema,
});

if (totalKernelDiameter !== 15) {
  failures.push(`Expected total capture sharpening kernel diameter 15, got ${totalKernelDiameter}.`);
}

finishFixtureCheck({
  failures,
  invalidCount: invalidCases.length,
  label: 'capture sharpening presets',
  validCount: presets.length,
});
