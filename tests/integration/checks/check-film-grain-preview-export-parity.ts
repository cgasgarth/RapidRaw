#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  applyFilmGrainRuntime,
  type FilmGrainRuntimePixelV1,
} from '../../../packages/rawengine-schema/src/filmGrainRuntime.ts';
import {
  filmGrainModelV1Schema,
  type FilmGrainModelV1,
} from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';
import { sampleFilmGrainModelV1 } from '../../../packages/rawengine-schema/src/samplePayloads.ts';

const MANIFEST_PATH = resolve('fixtures/film-simulation/film-grain-preview-export-parity.json');
const updateFixture = process.argv.includes('--update');
const WIDTH = 20;
const HEIGHT = 12;
const SOURCE_CONTENT_HASH = 'synthetic:film-grain-preview-export-parity:v1';
const VARIANT_KEY = 'preview-export-shared-seed';

const CASES = [
  { amount: 12, caseId: 'film.grain.preview_export.iso_100_fine', roughness: 35, size: 18 },
  { amount: 28, caseId: 'film.grain.preview_export.iso_400_classic', roughness: 50, size: 34 },
  { amount: 48, caseId: 'film.grain.preview_export.iso_1600_push', roughness: 72, size: 62 },
] as const;

const parityCaseSchema = z
  .object({
    afterHash: z.string().regex(/^sha256:[a-f0-9]{16}$/u),
    baselineMaxDelta: z.number().positive(),
    caseId: z.string().trim().min(1),
    changedPixelRatio: z.number().min(0).max(1),
    exportHash: z.string().regex(/^sha256:[a-f0-9]{16}$/u),
    maxAllowedPreviewExportDelta: z.literal(0),
    previewExportMaxDelta: z.literal(0),
    previewHash: z.string().regex(/^sha256:[a-f0-9]{16}$/u),
    seed: z.number().int().nonnegative(),
  })
  .strict();

const manifestSchema = z
  .object({
    cases: z.array(parityCaseSchema).length(CASES.length),
    doesNotProve: z.array(z.string().trim().min(1)).nonempty(),
    fixtureInput: z
      .object({
        colorSpace: z.literal('synthetic-display-linear-rgb'),
        kind: z.literal('synthetic-film-grain-preview-export-parity'),
        scene: z.literal('shadow-midtone-highlight-ramp-with-color-chips'),
      })
      .strict(),
    generatedFrom: z.literal('tests/integration/checks/check-film-grain-preview-export-parity.ts'),
    version: z.literal(1),
  })
  .strict();

const sourcePixels = makeSyntheticScene();

const buildModel = (testCase: (typeof CASES)[number]): FilmGrainModelV1 =>
  filmGrainModelV1Schema.parse({
    ...sampleFilmGrainModelV1,
    intensity: {
      amount: testCase.amount,
      roughness: testCase.roughness,
      size: testCase.size,
    },
  });

const runPreviewPath = (model: FilmGrainModelV1) =>
  applyFilmGrainRuntime(
    {
      imageId: 'film-grain-preview-export-parity',
      pixels: sourcePixels,
      sourceContentHash: SOURCE_CONTENT_HASH,
      variantKey: VARIANT_KEY,
    },
    model,
  );

const runExportPath = (model: FilmGrainModelV1): Array<FilmGrainRuntimePixelV1> => {
  const tileWidth = Math.ceil(WIDTH / 4);
  const outputPixels: Array<FilmGrainRuntimePixelV1> = [];

  for (let tileIndex = 0; tileIndex < 4; tileIndex += 1) {
    const startX = tileIndex * tileWidth;
    const endX = Math.min(WIDTH, startX + tileWidth);
    const tilePixels = sourcePixels.filter((pixel) => pixel.x >= startX && pixel.x < endX);
    const tileResult = applyFilmGrainRuntime(
      {
        imageId: 'film-grain-preview-export-parity',
        pixels: tilePixels,
        sourceContentHash: SOURCE_CONTENT_HASH,
        variantKey: VARIANT_KEY,
      },
      model,
    );
    outputPixels.push(...tileResult.outputPixels);
  }

  return outputPixels.toSorted((left, right) => left.y - right.y || left.x - right.x);
};

const runCase = (testCase: (typeof CASES)[number]) => {
  const model = buildModel(testCase);
  const preview = runPreviewPath(model);
  const exportPixels = runExportPath(model);
  const previewExportMaxDelta = maxDelta(preview.outputPixels, exportPixels);

  return parityCaseSchema.parse({
    afterHash: hashPixels(preview.outputPixels),
    baselineMaxDelta: maxDelta(sourcePixels, preview.outputPixels),
    caseId: testCase.caseId,
    changedPixelRatio: preview.metrics.changedPixelRatio,
    exportHash: hashPixels(exportPixels),
    maxAllowedPreviewExportDelta: 0,
    previewExportMaxDelta,
    previewHash: hashPixels(preview.outputPixels),
    seed: preview.provenance.seed,
  });
};

const expectedManifest = manifestSchema.parse({
  cases: CASES.map(runCase),
  doesNotProve: ['real_raw_quality', 'measured_film_stock_emulation', 'gpu_parity', 'photochemical_density_domain'],
  fixtureInput: {
    colorSpace: 'synthetic-display-linear-rgb',
    kind: 'synthetic-film-grain-preview-export-parity',
    scene: 'shadow-midtone-highlight-ramp-with-color-chips',
  },
  generatedFrom: 'tests/integration/checks/check-film-grain-preview-export-parity.ts',
  version: 1,
});
const expectedJson = `${JSON.stringify(expectedManifest, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, expectedJson);
  console.log('film grain preview/export parity updated');
  process.exit(0);
}

const currentManifest = manifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, 'utf8')));
if (JSON.stringify(currentManifest) !== JSON.stringify(expectedManifest)) {
  throw new Error(
    'Film grain preview/export parity fixture is stale. Run bun run check:film-grain-preview-export-parity:update.',
  );
}

console.log(`film grain preview/export parity ok (${currentManifest.cases.length} cases)`);

function makeSyntheticScene(): Array<FilmGrainRuntimePixelV1> {
  const pixels: Array<FilmGrainRuntimePixelV1> = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ramp = x / (WIDTH - 1);
      const row = y / (HEIGHT - 1);
      pixels.push({
        b: roundChannel(ramp * 0.62 + row * 0.14 + (y % 3 === 2 ? 0.08 : 0.02)),
        g: roundChannel(ramp * 0.74 + (1 - row) * 0.08 + (y % 3 === 1 ? 0.08 : 0.02)),
        r: roundChannel(ramp * 0.86 + row * 0.1 + (y % 3 === 0 ? 0.08 : 0.02)),
        x,
        y,
      });
    }
  }
  return pixels;
}

function hashPixels(pixels: ReadonlyArray<FilmGrainRuntimePixelV1>): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify(
        pixels.map((pixel) => [pixel.x, pixel.y, quantize(pixel.r), quantize(pixel.g), quantize(pixel.b)]),
      ),
    )
    .digest('hex')
    .slice(0, 16)}`;
}

function maxDelta(left: ReadonlyArray<FilmGrainRuntimePixelV1>, right: ReadonlyArray<FilmGrainRuntimePixelV1>): number {
  return Number(
    left
      .reduce((maximum, leftPixel, index) => {
        const rightPixel = right[index];
        if (rightPixel === undefined || leftPixel.x !== rightPixel.x || leftPixel.y !== rightPixel.y) {
          throw new Error('Film grain parity pixels must keep matching coordinates.');
        }
        return Math.max(
          maximum,
          Math.abs(leftPixel.r - rightPixel.r),
          Math.abs(leftPixel.g - rightPixel.g),
          Math.abs(leftPixel.b - rightPixel.b),
        );
      }, 0)
      .toFixed(6),
  );
}

function quantize(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 4095);
}

function roundChannel(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}
