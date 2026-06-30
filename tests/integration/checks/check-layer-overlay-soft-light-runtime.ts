#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import { renderLayerBlendStack } from '../../../src/utils/layers/layerPreviewExportParity.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-overlay-soft-light-runtime.json';
const OUTPUT_DIR = 'artifacts/layers/overlay-soft-light-runtime';

const pixelSchema = z
  .object({
    b: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    r: z.number().int().min(0).max(255),
  })
  .strict();

const caseSchema = z
  .object({
    basePixels: z.array(pixelSchema).min(1),
    expectedContrastDelta: z.number().positive(),
    expectedPixels: z.array(pixelSchema).min(1),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layer: z
      .object({
        blendMode: z.enum(['overlay', 'soft_light']),
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        opacity: z.number().min(0).max(1),
        pixels: z.array(pixelSchema).min(1),
        visible: z.boolean(),
      })
      .strict(),
    width: z.number().int().positive(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const pixelCount = fixture.width * fixture.height;
    for (const [path, pixels] of [
      ['basePixels', fixture.basePixels],
      ['layer.pixels', fixture.layer.pixels],
      ['expectedPixels', fixture.expectedPixels],
    ] as const) {
      if (pixels.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: `${path} must match dimensions.`, path: [path] });
      }
    }
  });

const manifestSchema = z
  .object({
    cases: z.array(caseSchema).length(2),
    colorAssumptions: z.array(z.string().trim().min(1)).min(1),
    version: z.literal(1),
  })
  .strict();

type LayerPixel = z.infer<typeof pixelSchema>;

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));

const averageLuma = (pixels: ReadonlyArray<LayerPixel>): number =>
  pixels.reduce((sum, pixel) => sum + (pixel.r + pixel.g + pixel.b) / 3, 0) / pixels.length;

const contrastDelta = (pixels: ReadonlyArray<LayerPixel>): number => {
  const lumaValues = pixels.map((pixel) => (pixel.r + pixel.g + pixel.b) / 3);
  return Math.max(...lumaValues) - Math.min(...lumaValues);
};

const writePpm = async (
  path: string,
  width: number,
  height: number,
  pixels: ReadonlyArray<LayerPixel>,
): Promise<void> => {
  const rows = [`P3`, `${width} ${height}`, '255'];
  for (let row = 0; row < height; row += 1) {
    const start = row * width;
    rows.push(
      pixels
        .slice(start, start + width)
        .map((pixel) => `${pixel.r} ${pixel.g} ${pixel.b}`)
        .join('  '),
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.join('\n')}\n`);
};

await mkdir(OUTPUT_DIR, { recursive: true });

const modes = new Set<string>();
const reportRows = [];

for (const fixture of manifest.cases) {
  modes.add(fixture.layer.blendMode);
  const rendered = renderLayerBlendStack({
    basePixels: fixture.basePixels,
    height: fixture.height,
    layers: [fixture.layer],
    width: fixture.width,
  });

  if (JSON.stringify(rendered.pixels) !== JSON.stringify(fixture.expectedPixels)) {
    throw new Error(`${fixture.id}: blend pixels do not match expected output.`);
  }

  const actualContrastDelta = Number(contrastDelta(rendered.pixels).toFixed(2));
  if (actualContrastDelta !== fixture.expectedContrastDelta) {
    throw new Error(`${fixture.id}: contrast delta ${actualContrastDelta} != ${fixture.expectedContrastDelta}.`);
  }

  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.before.ppm`), fixture.width, fixture.height, fixture.basePixels);
  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.after.ppm`), fixture.width, fixture.height, rendered.pixels);
  reportRows.push({
    baseLuma: averageLuma(fixture.basePixels),
    blendMode: fixture.layer.blendMode,
    colorAssumptions: manifest.colorAssumptions,
    id: fixture.id,
    renderedContrastDelta: actualContrastDelta,
    renderedLuma: averageLuma(rendered.pixels),
  });
}

if (!modes.has('overlay') || !modes.has('soft_light')) {
  throw new Error('Overlay/soft-light runtime fixture must cover both blend modes.');
}

await writeFile(
  resolve(OUTPUT_DIR, `layer-overlay-soft-light-runtime.report.json`),
  `${JSON.stringify(reportRows, null, 2)}\n`,
);

console.log(`layer overlay/soft-light runtime ok (${manifest.cases.length} cases)`);
