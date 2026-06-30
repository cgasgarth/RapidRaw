#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  type HeadlessRenderPixel,
  headlessRenderArtifactSchema,
  headlessRenderRequestSchema,
} from '../../src/schemas/export/headlessRenderCommandSchemas.ts';

const requestPath = valueAfter('--request');
const outputPathOverride = valueAfter('--output');

if (requestPath === undefined) {
  fail('usage: bun scripts/dev/rawengine-headless-render.ts --request <request.json> [--output <artifact.json>]');
}

const request = headlessRenderRequestSchema.parse(JSON.parse(await readFile(requestPath, 'utf8')));
const outputPath = resolve(outputPathOverride ?? request.outputArtifactPath);
const beforeHash = hashPixels(request.sourcePixels);
const outputPixels = renderBasicTone(request.sourcePixels, request.command.parameters);
const afterHash = hashPixels(outputPixels);
const changedPixels = outputPixels.filter((pixel, pixelIndex) =>
  pixel.some((channel, channelIndex) => channel !== request.sourcePixels[pixelIndex]?.[channelIndex]),
).length;

const artifact = headlessRenderArtifactSchema.parse({
  afterHash,
  beforeHash,
  changedPixels,
  commandId: request.command.commandId,
  graphRevision: request.command.expectedGraphRevision,
  outputPixels,
  renderer: request.renderer,
  schemaVersion: 1,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`headless render ok (${artifact.changedPixels} changed)`);

function renderBasicTone(
  pixels: Array<HeadlessRenderPixel>,
  parameters: {
    blackPoint: number;
    clarity: number;
    contrast: number;
    exposureEv: number;
    highlights: number;
    saturation: number;
    shadows: number;
    whitePoint: number;
  },
): Array<HeadlessRenderPixel> {
  return pixels.map((pixel) => {
    const exposureScale = 2 ** parameters.exposureEv;
    const contrastScale = 1 + parameters.contrast / 100;
    const saturationScale = 1 + parameters.saturation / 100;
    const lift = (parameters.shadows - parameters.blackPoint) / 500;
    const shoulder = (parameters.whitePoint - parameters.highlights) / 500;
    const clarity = parameters.clarity / 800;
    const mean = pixel.reduce((sum, channel) => sum + channel, 0) / pixel.length;

    return pixel.map((channel) => {
      const exposed = channel * exposureScale + lift + shoulder;
      const contrasted = (exposed - 0.5) * contrastScale + 0.5;
      const saturated = mean + (contrasted - mean) * saturationScale;
      return Number(clamp01(saturated + clarity * (channel - mean)).toFixed(6));
    }) as HeadlessRenderPixel;
  });
}

function hashPixels(pixels: Array<HeadlessRenderPixel>): string {
  return createHash('sha256').update(JSON.stringify(pixels)).digest('hex');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
