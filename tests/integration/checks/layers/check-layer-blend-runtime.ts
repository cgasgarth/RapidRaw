#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import {
  type LayerRgbPixel,
  layerBlendCoverageSchema,
  layerBlendStackInputSchema,
  layerBlendStackLayerSchema,
  layerRgbPixelSchema,
  renderLayerExportStack,
  renderLayerHeadlessStack,
  renderLayerPreviewStack,
} from '../../../../packages/rawengine-schema/src/layerBlendRuntime.ts';
import {
  layerMaskCloneSourceV1Schema,
  layerMaskRemoveSourceV1Schema,
} from '../../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-preview-export-parity.json';

const sidecarLayerSchema = z
  .object({
    blendMode: z.enum(['hue', 'multiply', 'normal', 'overlay', 'saturation', 'screen', 'soft_light']),
    id: z.string().trim().min(1),
    maskPersisted: z.boolean(),
    opacity: z.number().min(0).max(1),
    retouchCloneSource: layerMaskCloneSourceV1Schema.optional(),
    retouchRemoveSource: layerMaskRemoveSourceV1Schema.optional(),
    visible: z.boolean(),
  })
  .strict();

const sidecarLayerStackSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    layers: z.array(sidecarLayerSchema).min(1),
    schemaVersion: z.literal(1),
    sourceImagePath: z.string().trim().min(1),
    storage: z.literal('sidecar_artifact'),
  })
  .strict();

const fixtureCaseSchema = z
  .object({
    basePixels: z.array(layerRgbPixelSchema).min(1),
    expectedCoverageByLayer: z.array(layerBlendCoverageSchema).min(1),
    expectedPreviewExportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    height: z.number().int().positive().max(16384),
    id: z.string().trim().min(1),
    layers: z.array(layerBlendStackLayerSchema).min(1),
    sidecarLayerStack: sidecarLayerStackSchema,
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((fixture, context) => {
    const result = layerBlendStackInputSchema.safeParse({
      basePixels: fixture.basePixels,
      height: fixture.height,
      layers: fixture.layers,
      width: fixture.width,
    });
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue(issue);
    }
  });

const manifestSchema = z
  .object({
    cases: z.array(fixtureCaseSchema).min(1),
    version: z.literal(1),
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
const requiredBlendModes = new Set(['hue', 'multiply', 'normal', 'overlay', 'saturation', 'screen', 'soft_light']);

const hashPixels = (pixels: ReadonlyArray<LayerRgbPixel>): string => {
  const hash = createHash('sha256');
  for (const pixel of pixels) {
    hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  }
  return `sha256:${hash.digest('hex')}`;
};

const failures: Array<string> = [];
const toLayerBlendInput = (fixture: z.infer<typeof fixtureCaseSchema>) => ({
  basePixels: fixture.basePixels,
  height: fixture.height,
  layers: fixture.layers,
  width: fixture.width,
});

for (const fixture of manifest.cases) {
  const blendModes = new Set(fixture.layers.map((layer) => layer.blendMode));
  for (const mode of requiredBlendModes) {
    if (!blendModes.has(mode)) failures.push(`${fixture.id}: missing ${mode} blend coverage.`);
  }
  if (!fixture.layers.some((layer) => layer.opacity > 0 && layer.opacity < 1)) {
    failures.push(`${fixture.id}: missing partial-opacity layer.`);
  }
  if (!fixture.layers.some((layer) => layer.maskAlpha !== undefined)) {
    failures.push(`${fixture.id}: missing mask-alpha layer.`);
  }

  const layerBlendInput = toLayerBlendInput(fixture);
  const preview = renderLayerPreviewStack(layerBlendInput);
  const exported = renderLayerExportStack(layerBlendInput);
  const headless = renderLayerHeadlessStack(layerBlendInput);
  const previewHash = hashPixels(preview.pixels);
  if (previewHash !== hashPixels(exported.pixels) || previewHash !== hashPixels(headless.pixels)) {
    failures.push(`${fixture.id}: preview/export/headless hashes diverged.`);
  }
  if (previewHash !== fixture.expectedPreviewExportHash) {
    failures.push(`${fixture.id}: expected hash mismatch.`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(fixture.expectedCoverageByLayer)) {
    failures.push(`${fixture.id}: expected coverage mismatch.`);
  }

  const sidecarLayerIds = fixture.sidecarLayerStack.layers.map((layer) => layer.id);
  const fixtureLayerIds = fixture.layers.map((layer) => layer.id);
  if (JSON.stringify(sidecarLayerIds) !== JSON.stringify(fixtureLayerIds)) {
    failures.push(`${fixture.id}: sidecar layer order mismatch.`);
  }
}

const invalidFixture = manifest.cases[0];
const invalidLayer = invalidFixture?.layers[0];
if (invalidFixture === undefined || invalidLayer === undefined) {
  failures.push('Layer blend runtime fixture requires at least one layer.');
} else {
  const invalidInput = {
    ...invalidFixture,
    layers: [{ ...invalidLayer, blendMode: 'hard_light' }, ...invalidFixture.layers.slice(1)],
  };
  if (layerBlendStackInputSchema.safeParse(invalidInput).success) {
    failures.push('Layer blend runtime accepted unsupported blend mode.');
  }
}

if (failures.length > 0) {
  console.error('Layer blend runtime validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`layer blend runtime ok (${manifest.cases.length} case, ${requiredBlendModes.size} modes)`);
