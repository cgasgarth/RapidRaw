#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import { renderLayerBlendStack } from '../../../../src/utils/layers/layerPreviewExportParity.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-multiply-screen-runtime.json';
const OUTPUT_DIR = 'artifacts/layers/multiply-screen-runtime';

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
    expectedLumaDirection: z.enum(['darker', 'lighter']),
    expectedPixels: z.array(pixelSchema).min(1),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layer: z
      .object({
        blendMode: z.enum(['multiply', 'screen']),
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
    if (fixture.basePixels.length !== pixelCount) {
      context.addIssue({ code: 'custom', message: 'basePixels must match dimensions.', path: ['basePixels'] });
    }
    if (fixture.layer.pixels.length !== pixelCount) {
      context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layer', 'pixels'] });
    }
    if (fixture.expectedPixels.length !== pixelCount) {
      context.addIssue({ code: 'custom', message: 'expectedPixels must match dimensions.', path: ['expectedPixels'] });
    }
  });

const manifestSchema = z
  .object({
    cases: z.array(caseSchema).length(2),
    version: z.literal(1),
  })
  .strict();

type LayerPixel = z.infer<typeof pixelSchema>;

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));

const averageLuma = (pixels: ReadonlyArray<LayerPixel>): number =>
  pixels.reduce((sum, pixel) => sum + (pixel.r + pixel.g + pixel.b) / 3, 0) / pixels.length;

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

  const baseLuma = averageLuma(fixture.basePixels);
  const renderedLuma = averageLuma(rendered.pixels);
  const validDirection = fixture.expectedLumaDirection === 'darker' ? renderedLuma < baseLuma : renderedLuma > baseLuma;
  if (!validDirection) {
    throw new Error(`${fixture.id}: expected ${fixture.expectedLumaDirection} luma direction.`);
  }

  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.before.ppm`), fixture.width, fixture.height, fixture.basePixels);
  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.after.ppm`), fixture.width, fixture.height, rendered.pixels);
  reportRows.push({
    baseLuma,
    blendMode: fixture.layer.blendMode,
    id: fixture.id,
    renderedLuma,
  });
}

if (!modes.has('multiply') || !modes.has('screen')) {
  throw new Error('Multiply/screen runtime fixture must cover both blend modes.');
}

await writeFile(
  resolve(OUTPUT_DIR, `layer-multiply-screen-runtime.report.json`),
  `${JSON.stringify(reportRows, null, 2)}\n`,
);

console.log(`layer multiply/screen runtime ok (${manifest.cases.length} cases)`);
