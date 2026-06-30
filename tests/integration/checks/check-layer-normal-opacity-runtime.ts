#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import { renderLayerBlendStack } from '../../../src/utils/layers/layerPreviewExportParity.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-normal-opacity-runtime.json';
const OUTPUT_DIR = 'artifacts/layers/normal-opacity-runtime';

const pixelSchema = z
  .object({
    b: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    r: z.number().int().min(0).max(255),
  })
  .strict();

const sidecarLayerSchema = z
  .object({
    blendMode: z.literal('normal'),
    id: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    visible: z.boolean(),
  })
  .strict();

const fixtureSchema = z
  .object({
    basePixels: z.array(pixelSchema).min(1),
    expectedChangedPixels: z.number().int().positive(),
    expectedPixels: z.array(pixelSchema).min(1),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layer: z
      .object({
        blendMode: z.literal('normal'),
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        opacity: z.number().min(0).max(1),
        pixels: z.array(pixelSchema).min(1),
        visible: z.boolean(),
      })
      .strict(),
    sidecarLayerStack: z
      .object({
        artifactId: z.string().trim().min(1),
        layers: z.array(sidecarLayerSchema).length(1),
        schemaVersion: z.literal(1),
        sourceImagePath: z.string().trim().min(1),
        storage: z.literal('sidecar_artifact'),
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

type LayerPixel = z.infer<typeof pixelSchema>;

const fixture = fixtureSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));

const hashPixels = (pixels: ReadonlyArray<LayerPixel>): string => {
  const hash = createHash('sha256');
  for (const pixel of pixels) {
    hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  }
  return `sha256:${hash.digest('hex')}`;
};

const countChangedPixels = (beforePixels: ReadonlyArray<LayerPixel>, afterPixels: ReadonlyArray<LayerPixel>): number =>
  beforePixels.filter((pixel, index) => {
    const afterPixel = afterPixels[index];
    return (
      afterPixel !== undefined && (pixel.r !== afterPixel.r || pixel.g !== afterPixel.g || pixel.b !== afterPixel.b)
    );
  }).length;

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

const originalBaseHash = hashPixels(fixture.basePixels);
const rendered = renderLayerBlendStack({
  basePixels: fixture.basePixels,
  height: fixture.height,
  layers: [fixture.layer],
  width: fixture.width,
});
const postRenderBaseHash = hashPixels(fixture.basePixels);

if (originalBaseHash !== postRenderBaseHash) {
  throw new Error('Normal opacity runtime mutated the source/base pixels.');
}

if (JSON.stringify(rendered.pixels) !== JSON.stringify(fixture.expectedPixels)) {
  throw new Error('Normal opacity runtime pixels do not match expected blend output.');
}

const changedPixels = countChangedPixels(fixture.basePixels, rendered.pixels);
if (changedPixels !== fixture.expectedChangedPixels) {
  throw new Error(`Normal opacity changed ${changedPixels} pixels; expected ${fixture.expectedChangedPixels}.`);
}

const sidecarLayer = fixture.sidecarLayerStack.layers[0];
if (sidecarLayer?.id !== fixture.layer.id || sidecarLayer.opacity !== fixture.layer.opacity) {
  throw new Error('Normal opacity sidecar layer state does not match runtime layer.');
}

await mkdir(OUTPUT_DIR, { recursive: true });
await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.before.ppm`), fixture.width, fixture.height, fixture.basePixels);
await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.after.ppm`), fixture.width, fixture.height, rendered.pixels);
await writeFile(
  resolve(OUTPUT_DIR, `${fixture.id}.report.json`),
  `${JSON.stringify(
    {
      changedPixels,
      originalBaseHash,
      renderedHash: hashPixels(rendered.pixels),
      sidecarArtifactId: fixture.sidecarLayerStack.artifactId,
      sourceImagePath: fixture.sidecarLayerStack.sourceImagePath,
    },
    null,
    2,
  )}\n`,
);

console.log(`layer normal opacity runtime ok (${changedPixels} changed pixels)`);
