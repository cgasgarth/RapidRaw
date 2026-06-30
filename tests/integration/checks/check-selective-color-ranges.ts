#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { SELECTIVE_COLOR_RANGES } from '../../../src/utils/selectiveColorRanges.ts';

const FIXTURE_PATH = 'fixtures/color/selective-color/selective-color-ranges.json';
const SHADER_PATH = 'src-tauri/src/shaders/shader.wgsl';
const COLOR_PANEL_PATH = 'src/components/adjustments/Color.tsx';

const rangeKeySchema = z.enum(['reds', 'oranges', 'yellows', 'greens', 'aquas', 'blues', 'purples', 'magentas']);
const labelKeySchema = z.enum(rangeKeySchema.options.map((key) => `adjustments.color.mixerColors.${key}`));

const rangeSchema = z
  .object({
    centerHueDegrees: z.number().min(0).lt(360),
    key: rangeKeySchema,
    labelKey: labelKeySchema,
    widthDegrees: z.number().positive().max(180),
  })
  .strict();

const manifestSchema = z
  .object({
    $schema: z.string().url(),
    issue: z.literal(96),
    ranges: z.array(rangeSchema).length(8),
    schemaVersion: z.literal(1),
    snapshotDate: z.string().date(),
  })
  .strict();

const parseShaderRanges = (source) => {
  const match = source.match(/const HSL_RANGES:[\s\S]*?array<HslRange, 8>\(([\s\S]*?)\);/u);
  if (!match) throw new Error('Missing WGSL HSL_RANGES definition.');

  return [...match[1].matchAll(/HslRange\(([-0-9.]+),\s*([-0-9.]+)\)/gu)].map((entry) => ({
    centerHueDegrees: Number(entry[1]),
    widthDegrees: Number(entry[2]),
  }));
};

const fixture = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const shaderRanges = parseShaderRanges(await readFile(SHADER_PATH, 'utf8'));
const colorPanelSource = await readFile(COLOR_PANEL_PATH, 'utf8');

const failures = [];

if (shaderRanges.length !== fixture.ranges.length) {
  failures.push(`WGSL exposes ${shaderRanges.length} ranges; fixture expects ${fixture.ranges.length}.`);
}

for (const [index, expectedRange] of fixture.ranges.entries()) {
  const actualRange = SELECTIVE_COLOR_RANGES[index];
  const shaderRange = shaderRanges[index];

  if (actualRange === undefined) {
    failures.push(`${expectedRange.key}: missing TypeScript range at index ${index}.`);
    continue;
  }

  if (actualRange.key !== expectedRange.key) {
    failures.push(`${expectedRange.key}: TypeScript range key mismatch: ${actualRange.key}.`);
  }
  if (actualRange.labelKey !== expectedRange.labelKey) {
    failures.push(`${expectedRange.key}: TypeScript label key mismatch: ${actualRange.labelKey}.`);
  }
  if (actualRange.centerHueDegrees !== expectedRange.centerHueDegrees) {
    failures.push(`${expectedRange.key}: TypeScript center mismatch: ${actualRange.centerHueDegrees}.`);
  }
  if (actualRange.widthDegrees !== expectedRange.widthDegrees) {
    failures.push(`${expectedRange.key}: TypeScript width mismatch: ${actualRange.widthDegrees}.`);
  }

  if (shaderRange === undefined) {
    failures.push(`${expectedRange.key}: missing WGSL range at index ${index}.`);
    continue;
  }
  if (shaderRange.centerHueDegrees !== expectedRange.centerHueDegrees) {
    failures.push(`${expectedRange.key}: WGSL center mismatch: ${shaderRange.centerHueDegrees}.`);
  }
  if (shaderRange.widthDegrees !== expectedRange.widthDegrees) {
    failures.push(`${expectedRange.key}: WGSL width mismatch: ${shaderRange.widthDegrees}.`);
  }
}

for (const marker of [
  'selective-color-range-summary',
  'selective-color-range-summary-label',
  'selective-color-range-summary-center',
  'selective-color-range-summary-width',
  'activeSelectiveColorRange.widthDegrees',
]) {
  if (!colorPanelSource.includes(marker)) {
    failures.push(`Color Mixer UI is missing selective color range summary marker: ${marker}.`);
  }
}

if (failures.length > 0) {
  console.error('Selective color range validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${fixture.ranges.length} selective color ranges against TypeScript and WGSL.`);
