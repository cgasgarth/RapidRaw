#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';

import {
  noiseMetricFixtureManifestSchema,
  parseNoiseMetricFixtureManifest,
} from '../../../src/schemas/noiseMetricSchemas.ts';

const MANIFEST_PATH = 'fixtures/detail/denoise/noise-metric-fixtures.json';
const INVALID_PATH = 'fixtures/detail/invalid/denoise/invalid-noise-metric-fixtures.json';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function stableUnit(seed, x, y, channel) {
  let hash = 2166136261;
  const input = `${seed}:${x}:${y}:${channel}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function centeredNoise(seed, x, y, channel, sigma) {
  return (stableUnit(seed, x, y, channel) - 0.5) * 2 * sigma;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function basePixel(fixtureCase, x, y) {
  const ramp = 0.24 + (x / Math.max(1, fixtureCase.width - 1)) * 0.32;
  const edgeStep = x >= fixtureCase.width / 2 ? 0.18 : -0.08;
  const texture = x >= 12 && x < 60 && y >= 56 && y < 84 ? Math.sin((x + y) * 0.9) * 0.045 : 0;
  const chromaBias = fixtureCase.generator.basePattern === 'chroma_speckle_edge_texture' ? 0.035 : 0.01;
  const luma = ramp + edgeStep + texture;
  return {
    b: clamp01(luma - chromaBias),
    g: clamp01(luma),
    r: clamp01(luma + chromaBias),
  };
}

function generatePixel(fixtureCase, x, y) {
  const base = basePixel(fixtureCase, x, y);
  const lumaNoise = centeredNoise(fixtureCase.generator.seed, x, y, 0, fixtureCase.generator.lumaNoiseSigma);
  const chromaNoise = centeredNoise(fixtureCase.generator.seed, x, y, 1, fixtureCase.generator.chromaNoiseSigma);
  return {
    b: clamp01(base.b + lumaNoise - chromaNoise),
    g: clamp01(base.g + lumaNoise),
    r: clamp01(base.r + lumaNoise + chromaNoise),
  };
}

function luma(pixel) {
  return pixel.r * 0.2126 + pixel.g * 0.7152 + pixel.b * 0.0722;
}

function chroma(pixel) {
  return Math.hypot(pixel.r - pixel.g, pixel.b - pixel.g);
}

function collectRegion(fixtureCase, region) {
  const pixels = [];
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      pixels.push({ pixel: generatePixel(fixtureCase, x, y), x, y });
    }
  }
  return pixels;
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values) {
  const average = mean(values);
  const variance = mean(values.map((value) => (value - average) ** 2));
  return Math.sqrt(variance);
}

function edgeContrast(fixtureCase) {
  const region = fixtureCase.regions.edge;
  const midpoint = region.x + Math.floor(region.width / 2);
  const left = [];
  const right = [];
  for (const sample of collectRegion(fixtureCase, region)) {
    if (sample.x < midpoint) {
      left.push(luma(sample.pixel));
    } else {
      right.push(luma(sample.pixel));
    }
  }
  return Math.abs(mean(right) - mean(left));
}

function highFrequencyEnergy(fixtureCase) {
  const region = fixtureCase.regions.texture;
  const values = [];
  for (let y = region.y; y < region.y + region.height - 1; y += 1) {
    for (let x = region.x; x < region.x + region.width - 1; x += 1) {
      const current = luma(generatePixel(fixtureCase, x, y));
      const right = luma(generatePixel(fixtureCase, x + 1, y));
      const down = luma(generatePixel(fixtureCase, x, y + 1));
      values.push(Math.abs(current - right));
      values.push(Math.abs(current - down));
    }
  }
  return mean(values);
}

function calculateMetrics(fixtureCase) {
  const flatPatch = collectRegion(fixtureCase, fixtureCase.regions.flatPatch);
  const texturePatch = collectRegion(fixtureCase, fixtureCase.regions.texture);
  return {
    chromaSigma: standardDeviation(flatPatch.map((sample) => chroma(sample.pixel))),
    edgeContrast: edgeContrast(fixtureCase),
    highFrequencyEnergy: highFrequencyEnergy(fixtureCase),
    lumaSigma: standardDeviation(flatPatch.map((sample) => luma(sample.pixel))),
    textureEnergy: standardDeviation(texturePatch.map((sample) => luma(sample.pixel))),
  };
}

function metricInRange(value, range) {
  return value >= range.min && value <= range.max;
}

function formatMetric(value) {
  return value.toFixed(6);
}

const manifest = parseNoiseMetricFixtureManifest(await readJson(MANIFEST_PATH));
const invalidCases = await readJson(INVALID_PATH);
const failures = [];
const warnings = [];

for (const fixtureCase of manifest.cases) {
  const metrics = calculateMetrics(fixtureCase);
  for (const [metricName, value] of Object.entries(metrics)) {
    if (!Number.isFinite(value)) {
      failures.push(`${fixtureCase.id}: ${metricName} was not finite.`);
      continue;
    }
    if (!metricInRange(value, fixtureCase.expectedMetrics[metricName])) {
      failures.push(
        `${fixtureCase.id}: ${metricName}=${formatMetric(value)} outside expected range ` +
          `${fixtureCase.expectedMetrics[metricName].min}-${fixtureCase.expectedMetrics[metricName].max}.`,
      );
    }
  }

  const chromaDominanceRatio = metrics.chromaSigma / Math.max(metrics.lumaSigma, Number.EPSILON);
  if (chromaDominanceRatio > fixtureCase.warningThresholds.chromaDominanceRatio) {
    warnings.push(`${fixtureCase.id}: chroma dominance ratio ${formatMetric(chromaDominanceRatio)} exceeds warning.`);
  }
  if (metrics.edgeContrast < fixtureCase.warningThresholds.minEdgeContrast) {
    warnings.push(`${fixtureCase.id}: edge contrast ${formatMetric(metrics.edgeContrast)} below warning threshold.`);
  }
  if (metrics.textureEnergy < fixtureCase.warningThresholds.minTextureEnergy) {
    warnings.push(`${fixtureCase.id}: texture energy ${formatMetric(metrics.textureEnergy)} below warning threshold.`);
  }

  console.log(
    `${fixtureCase.id}: ` +
      `lumaSigma=${formatMetric(metrics.lumaSigma)} ` +
      `chromaSigma=${formatMetric(metrics.chromaSigma)} ` +
      `edgeContrast=${formatMetric(metrics.edgeContrast)} ` +
      `textureEnergy=${formatMetric(metrics.textureEnergy)} ` +
      `highFrequencyEnergy=${formatMetric(metrics.highFrequencyEnergy)}`,
  );
}

for (const invalidCase of invalidCases) {
  const result = noiseMetricFixtureManifestSchema.safeParse(invalidCase.payload);
  if (result.success) {
    failures.push(`${invalidCase.case}: expected fixture manifest rejection.`);
  }
}

if (warnings.length > 0) {
  console.warn('Noise metric fixture warnings:');
  console.warn(warnings.join('\n'));
}

if (failures.length > 0) {
  console.error('Noise metric fixture validation failed.');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(
  `Validated ${manifest.cases.length} synthetic noise metric fixtures and ${invalidCases.length} invalid cases.`,
);
