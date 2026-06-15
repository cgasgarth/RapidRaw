#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const manifestPath = resolve('fixtures/render/artifact-comparison-cases.json');

const CaseSchema = z
  .object({
    actual: z.string().min(1),
    expected: z.string().min(1),
    id: z.string().min(1),
    maxMeanDiff: z.number().min(0).max(255),
    maxPixelDiff: z.number().int().min(0).max(255),
    minChangedPixels: z.number().int().min(0).optional(),
  })
  .strict();

const ManifestSchema = z
  .object({
    cases: z.array(CaseSchema).min(1),
    version: z.literal(1),
  })
  .strict();

function stripPpmComments(contents) {
  return contents
    .split('\n')
    .map((line) => line.replace(/#.*$/u, '').trim())
    .filter(Boolean)
    .join(' ');
}

async function readPpm(filePath) {
  const text = await readFile(filePath, 'utf8');
  const tokens = stripPpmComments(text).split(/\s+/u);
  const [magic, widthToken, heightToken, maxValueToken, ...pixelTokens] = tokens;

  if (magic !== 'P3') throw new Error(`${filePath}: only ASCII P3 PPM fixtures are supported`);

  const width = Number(widthToken);
  const height = Number(heightToken);
  const maxValue = Number(maxValueToken);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${filePath}: invalid dimensions`);
  }

  if (maxValue !== 255) throw new Error(`${filePath}: max value must be 255`);

  const expectedLength = width * height * 3;
  if (pixelTokens.length !== expectedLength) {
    throw new Error(`${filePath}: expected ${expectedLength} channel values, found ${pixelTokens.length}`);
  }

  return {
    height,
    pixels: pixelTokens.map((token) => {
      const value = Number(token);
      if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${filePath}: invalid pixel ${token}`);
      return value;
    }),
    width,
  };
}

function compareImages(expected, actual) {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`dimension mismatch: ${expected.width}x${expected.height} != ${actual.width}x${actual.height}`);
  }

  let maxDiff = 0;
  let totalDiff = 0;
  let changedPixels = 0;

  for (let pixelIndex = 0; pixelIndex < expected.width * expected.height; pixelIndex += 1) {
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const offset = pixelIndex * 3 + channel;
      const diff = Math.abs(expected.pixels[offset] - actual.pixels[offset]);
      maxDiff = Math.max(maxDiff, diff);
      totalDiff += diff;
      pixelChanged ||= diff > 0;
    }
    if (pixelChanged) changedPixels += 1;
  }

  return {
    changedPixels,
    maxDiff,
    meanDiff: totalDiff / expected.pixels.length,
    pixelCount: expected.width * expected.height,
  };
}

const manifest = ManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const baseDir = dirname(manifestPath);
const failures = [];

for (const artifactCase of manifest.cases) {
  const [expected, actual] = await Promise.all([
    readPpm(resolve(baseDir, artifactCase.expected)),
    readPpm(resolve(baseDir, artifactCase.actual)),
  ]);
  const metrics = compareImages(expected, actual);

  if (metrics.maxDiff > artifactCase.maxPixelDiff) {
    failures.push(`${artifactCase.id}: max diff ${metrics.maxDiff} > ${artifactCase.maxPixelDiff}`);
  }
  if (metrics.meanDiff > artifactCase.maxMeanDiff) {
    failures.push(`${artifactCase.id}: mean diff ${metrics.meanDiff.toFixed(4)} > ${artifactCase.maxMeanDiff}`);
  }
  if (artifactCase.minChangedPixels !== undefined && metrics.changedPixels < artifactCase.minChangedPixels) {
    failures.push(`${artifactCase.id}: changed pixels ${metrics.changedPixels} < ${artifactCase.minChangedPixels}`);
  }
}

if (failures.length > 0) {
  console.error('render artifact comparison failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`render artifacts ok (${manifest.cases.length})`);
