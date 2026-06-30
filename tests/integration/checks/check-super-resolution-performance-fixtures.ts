#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

const BYTES_PER_LINEAR_RGBA16_PIXEL = 8;
const SMOKE_MAX_OUTPUT_PIXELS = 60_000_000;
const SMOKE_MAX_PEAK_MEMORY_BYTES = 4_294_967_296;
const SMOKE_MAX_RUNTIME_MS = 15_000;

const SrPerformanceFixtureSchema = z
  .object({
    budgets: z
      .object({
        maxEstimatedPeakMemoryBytes: z.number().int().positive(),
        maxEstimatedRuntimeMs: z.number().int().positive(),
      })
      .strict(),
    ciLane: z.enum(['smoke', 'manual', 'nightly']),
    effectiveScale: z.number().positive().max(4),
    expectedWarningCodes: z.array(z.string().trim().min(1)),
    finalApplyAllowed: z.boolean(),
    id: z.string().regex(/^sr-[a-z0-9-]+$/u),
    mode: z.enum(['single_image', 'multi_image', 'panorama_style']),
    outputDimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    requestedScale: z.number().positive().max(4),
    sourceCount: z.number().int().positive(),
  })
  .strict();

const SrPerformanceManifestSchema = z
  .object({
    fixtures: z.array(SrPerformanceFixtureSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict();

const formatBytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

const manifestPath = resolve('docs/validation/fixtures/super-resolution-performance-fixtures.json');
const manifest = SrPerformanceManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const fixtureIds = new Set();
const failures = [];

for (const fixture of manifest.fixtures) {
  if (fixtureIds.has(fixture.id)) {
    failures.push(`${fixture.id}: fixture IDs must be unique.`);
  }
  fixtureIds.add(fixture.id);

  const outputPixels = fixture.outputDimensions.width * fixture.outputDimensions.height;
  const minimumOutputBytes = outputPixels * BYTES_PER_LINEAR_RGBA16_PIXEL;

  if (minimumOutputBytes > fixture.budgets.maxEstimatedPeakMemoryBytes) {
    failures.push(
      `${fixture.id}: peak memory budget ${formatBytes(
        fixture.budgets.maxEstimatedPeakMemoryBytes,
      )} cannot hold linear RGBA16 output ${formatBytes(minimumOutputBytes)}.`,
    );
  }

  if (fixture.effectiveScale > fixture.requestedScale) {
    failures.push(`${fixture.id}: effectiveScale cannot exceed requestedScale.`);
  }

  if (fixture.mode === 'single_image' && fixture.sourceCount !== 1) {
    failures.push(`${fixture.id}: single_image fixtures require exactly one source.`);
  }

  if (fixture.mode === 'single_image' && fixture.finalApplyAllowed) {
    failures.push(`${fixture.id}: single_image fixtures are preview-only until dedicated validation lands.`);
  }

  if (fixture.mode === 'multi_image' && fixture.sourceCount < 2) {
    failures.push(`${fixture.id}: multi_image fixtures require at least two sources.`);
  }

  if (fixture.mode === 'panorama_style' && fixture.sourceCount < 2) {
    failures.push(`${fixture.id}: panorama_style fixtures require at least two sources.`);
  }

  if (fixture.mode === 'panorama_style' && !fixture.expectedWarningCodes.includes('effective_scale_downgraded')) {
    failures.push(`${fixture.id}: panorama_style fixtures must disclose effective scale downgrade risk.`);
  }

  if (fixture.ciLane === 'smoke') {
    if (outputPixels > SMOKE_MAX_OUTPUT_PIXELS) {
      failures.push(`${fixture.id}: smoke fixtures must stay at or below ${SMOKE_MAX_OUTPUT_PIXELS} pixels.`);
    }

    if (fixture.budgets.maxEstimatedPeakMemoryBytes > SMOKE_MAX_PEAK_MEMORY_BYTES) {
      failures.push(`${fixture.id}: smoke fixtures must stay at or below ${formatBytes(SMOKE_MAX_PEAK_MEMORY_BYTES)}.`);
    }

    if (fixture.budgets.maxEstimatedRuntimeMs > SMOKE_MAX_RUNTIME_MS) {
      failures.push(`${fixture.id}: smoke fixtures must stay at or below ${SMOKE_MAX_RUNTIME_MS} ms runtime budget.`);
    }
  }
}

if (failures.length > 0) {
  console.error('Super-resolution performance fixture validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Validated ${manifest.fixtures.length} super-resolution performance fixture plans.`);
