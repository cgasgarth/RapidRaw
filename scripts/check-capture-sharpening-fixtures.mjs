#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  captureSharpeningPresetSchema,
  estimateCaptureSharpeningKernelDiameter,
  parseCaptureSharpeningPreset,
} from '../src/schemas/captureSharpeningSchemas.ts';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const presets = await readJson('fixtures/detail/capture-sharpening-presets.json');
const invalidCases = await readJson('fixtures/detail/invalid-capture-sharpening-presets.json');
const failures = [];

let totalKernelDiameter = 0;

for (const presetValue of presets) {
  const preset = parseCaptureSharpeningPreset(presetValue);
  totalKernelDiameter += estimateCaptureSharpeningKernelDiameter(preset);
}

for (const invalidCase of invalidCases) {
  const result = captureSharpeningPresetSchema.safeParse(invalidCase.preset);
  if (result.success) {
    failures.push(`${invalidCase.case} unexpectedly passed.`);
  }
}

if (totalKernelDiameter !== 15) {
  failures.push(`Expected total capture sharpening kernel diameter 15, got ${totalKernelDiameter}.`);
}

if (failures.length > 0) {
  console.error('Capture sharpening fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${presets.length} capture sharpening presets and ${invalidCases.length} invalid cases.`);
