#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import { parseDetailPreviewExportParityFixtures } from '../src/schemas/detailPreviewExportParitySchemas.ts';

const fixtures = parseDetailPreviewExportParityFixtures(
  JSON.parse(await readFile('fixtures/detail/detail-preview-export-parity.json', 'utf8')),
);

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function roundSample(value) {
  return Number(value.toFixed(3));
}

function renderDetailStage(samples, settings) {
  if (!settings.enabled) {
    return samples.map(roundSample);
  }

  const amount = settings.detailAmount / 100;
  const radiusWeight = Math.min(1, settings.radiusPx / 8);
  return samples.map((sample, index) => {
    const left = samples[index - 1] ?? sample;
    const right = samples[index + 1] ?? sample;
    const localMean = (left + sample + right) / 3;
    const localDetail = sample - localMean;
    return roundSample(clamp01(sample + localDetail * amount * (1 - radiusWeight * 0.35)));
  });
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const failures = [];

for (const fixture of fixtures) {
  const previewOutput = renderDetailStage(fixture.inputSamples, fixture.settings);
  const exportOutput = renderDetailStage(fixture.inputSamples, fixture.settings);

  if (!arraysEqual(previewOutput, exportOutput)) {
    failures.push(`${fixture.fixtureId} preview/export outputs diverged.`);
  }

  if (!arraysEqual(previewOutput, fixture.expectedOutput)) {
    failures.push(`${fixture.fixtureId} output changed: expected ${fixture.expectedOutput}, got ${previewOutput}.`);
  }

  if (!fixture.settings.enabled && !arraysEqual(previewOutput, fixture.inputSamples)) {
    failures.push(`${fixture.fixtureId} disabled detail stage changed samples.`);
  }
}

if (failures.length > 0) {
  console.error('Detail preview/export parity validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Validated ${fixtures.length} detail preview/export parity fixtures.`);
