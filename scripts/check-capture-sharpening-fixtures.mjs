#!/usr/bin/env bun

import {
  captureSharpeningPresetSchema,
  estimateCaptureSharpeningKernelDiameter,
  parseCaptureSharpeningPreset,
} from '../src/schemas/captureSharpeningSchemas.ts';
import { expectInvalidCases, finishFixtureCheck, readJson } from './lib/fixture-checks.mjs';

const presets = await readJson('fixtures/detail/capture-sharpening-presets.json');
const invalidCases = await readJson('fixtures/detail/invalid-capture-sharpening-presets.json');
const failures = [];

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
