#!/usr/bin/env bun
// @ts-check

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import {
  renderLayerExportStack,
  renderLayerHeadlessStack,
  renderLayerPreviewStack,
} from '../../../src/utils/layerPreviewExportParity.ts';
import { layerMaskBlendModeV1Schema } from '../../../packages/rawengine-schema/src/rawEngineSchemas.ts';

const FIXTURE_PATH = 'fixtures/layers/layer-preview-export-parity.json';
const OUTPUT_DIR = 'artifacts/layers/preview-export-parity';
const REQUIRED_BLEND_MODES = new Set(['multiply', 'normal', 'overlay', 'screen', 'soft_light']);

const pixelSchema = z
  .object({
    b: z.number().int().min(0).max(255),
    g: z.number().int().min(0).max(255),
    r: z.number().int().min(0).max(255),
  })
  .strict();

const layerSchema = z
  .object({
    blendMode: layerMaskBlendModeV1Schema.extract(['multiply', 'normal', 'overlay', 'screen', 'soft_light']),
    id: z.string().trim().min(1),
    maskAlpha: z.array(z.number().min(0).max(1)).optional(),
    name: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    pixels: z.array(pixelSchema).min(1).optional(),
    retouchCloneSource: z
      .object({
        alignmentErrorPx: z.number().min(0).optional(),
        rotationDegrees: z.number().min(-180).max(180),
        scale: z.number().min(0.1).max(10),
        sourcePoint: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
        targetPoint: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
    visible: z.boolean(),
  })
  .strict();

const sidecarLayerSchema = z
  .object({
    blendMode: layerMaskBlendModeV1Schema.extract(['multiply', 'normal', 'overlay', 'screen', 'soft_light']),
    id: z.string().trim().min(1),
    maskPersisted: z.boolean(),
    opacity: z.number().min(0).max(1),
    retouchCloneSource: z
      .object({
        alignmentErrorPx: z.number().min(0).optional(),
        rotationDegrees: z.number().min(-180).max(180),
        scale: z.number().min(0.1).max(10),
        sourcePoint: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
        targetPoint: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
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

const coverageSchema = z
  .object({
    id: z.string().trim().min(1),
    opacity: z.number().min(0).max(1),
    touchedPixels: z.number().int().nonnegative(),
  })
  .strict();

const caseSchema = z
  .object({
    basePixels: z.array(pixelSchema).min(1),
    cases: z.never().optional(),
    expectedCoverageByLayer: z.array(coverageSchema).min(1),
    expectedPreviewExportHash: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    layers: z.array(layerSchema).min(1),
    sidecarLayerStack: sidecarLayerStackSchema,
    width: z.number().int().positive(),
  })
  .strict()
  .superRefine((fixture, context) => {
    const pixelCount = fixture.width * fixture.height;
    if (fixture.basePixels.length !== pixelCount) {
      context.addIssue({ code: 'custom', message: 'basePixels must match dimensions.', path: ['basePixels'] });
    }

    for (const [index, layer] of fixture.layers.entries()) {
      if (layer.retouchCloneSource === undefined && layer.pixels?.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layers', index] });
      }
      if (layer.retouchCloneSource !== undefined && layer.pixels !== undefined && layer.pixels.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'layer pixels must match dimensions.', path: ['layers', index] });
      }
      if (layer.maskAlpha !== undefined && layer.maskAlpha.length !== pixelCount) {
        context.addIssue({ code: 'custom', message: 'maskAlpha must match dimensions.', path: ['layers', index] });
      }
    }
  });

const manifestSchema = z
  .object({
    cases: z.array(caseSchema).min(1),
    version: z.literal(1),
  })
  .strict();

const manifest = manifestSchema.parse(JSON.parse(await readFile(FIXTURE_PATH, 'utf8')));
await mkdir(OUTPUT_DIR, { recursive: true });

const hashPixels = (pixels) => {
  const hash = createHash('sha256');
  for (const pixel of pixels) {
    hash.update(Uint8Array.of(pixel.r, pixel.g, pixel.b));
  }
  return `sha256:${hash.digest('hex')}`;
};

const writePpm = async (path, width, height, pixels) => {
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

const fail = (message, details = []) => {
  console.error(message);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
};

for (const fixture of manifest.cases) {
  const blendModes = new Set(fixture.layers.map((layer) => layer.blendMode));
  const missingBlendModes = [...REQUIRED_BLEND_MODES].filter((mode) => !blendModes.has(mode));
  if (missingBlendModes.length > 0) fail(`${fixture.id}: missing blend mode coverage`, missingBlendModes);
  if (!fixture.layers.some((layer) => layer.opacity > 0 && layer.opacity < 1))
    fail(`${fixture.id}: missing partial opacity`);
  if (!fixture.layers.some((layer) => layer.maskAlpha !== undefined)) fail(`${fixture.id}: missing mask interaction`);
  const cloneLayer = fixture.layers.find((layer) => layer.retouchCloneSource !== undefined);
  if (cloneLayer === undefined) fail(`${fixture.id}: missing retouch clone source layer`);
  if (cloneLayer.pixels !== undefined) fail(`${fixture.id}: clone source layer should sample from source pixels`);

  const sidecarLayerIds = fixture.sidecarLayerStack.layers.map((layer) => layer.id);
  const fixtureLayerIds = fixture.layers.map((layer) => layer.id);
  if (JSON.stringify(sidecarLayerIds) !== JSON.stringify(fixtureLayerIds)) {
    fail(`${fixture.id}: sidecar layer order mismatch`);
  }

  const preview = renderLayerPreviewStack(fixture);
  const exported = renderLayerExportStack(fixture);
  const headless = renderLayerHeadlessStack(fixture);
  const previewHash = hashPixels(preview.pixels);
  const exportHash = hashPixels(exported.pixels);
  const headlessHash = hashPixels(headless.pixels);
  if (previewHash !== exportHash) {
    fail(`${fixture.id}: preview/export pixel hash mismatch`, [previewHash, exportHash]);
  }
  if (previewHash !== headlessHash) {
    fail(`${fixture.id}: preview/headless pixel hash mismatch`, [previewHash, headlessHash]);
  }
  if (previewHash !== fixture.expectedPreviewExportHash) {
    fail(`${fixture.id}: preview/export expected hash mismatch`, [previewHash, fixture.expectedPreviewExportHash]);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(exported.coverageByLayer)) {
    fail(`${fixture.id}: preview/export coverage mismatch`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(headless.coverageByLayer)) {
    fail(`${fixture.id}: preview/headless coverage mismatch`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(fixture.expectedCoverageByLayer)) {
    fail(`${fixture.id}: expected coverage mismatch`);
  }

  const sidecarRoundtrip = sidecarLayerStackSchema.parse(JSON.parse(JSON.stringify(fixture.sidecarLayerStack)));
  if (sidecarRoundtrip.storage !== 'sidecar_artifact') fail(`${fixture.id}: sidecar storage mismatch`);
  if (!sidecarRoundtrip.layers.some((layer) => layer.retouchCloneSource?.sourcePoint.x === 0)) {
    fail(`${fixture.id}: sidecar clone source linkage missing`);
  }

  const transformedCloneLayer = {
    ...cloneLayer,
    retouchCloneSource: {
      ...cloneLayer.retouchCloneSource,
      rotationDegrees: 2,
    },
  };
  let rejectedTransformedClone = false;
  try {
    renderLayerPreviewStack({ ...fixture, layers: [transformedCloneLayer] });
  } catch (error) {
    rejectedTransformedClone = error instanceof Error && error.message.includes('exact translated sampling only');
  }
  if (!rejectedTransformedClone) fail(`${fixture.id}: transformed clone rendering should be gated`);

  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.preview.ppm`), fixture.width, fixture.height, preview.pixels);
  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.export.ppm`), fixture.width, fixture.height, exported.pixels);
  await writePpm(resolve(OUTPUT_DIR, `${fixture.id}.headless.ppm`), fixture.width, fixture.height, headless.pixels);
  await writeFile(
    resolve(OUTPUT_DIR, `${fixture.id}.report.json`),
    `${JSON.stringify(
      {
        coverageByLayer: preview.coverageByLayer,
        exportHash,
        headlessHash,
        previewHash,
        sidecarArtifactId: fixture.sidecarLayerStack.artifactId,
      },
      null,
      2,
    )}\n`,
  );
}

const unsupportedBlendModeCase = manifest.cases[0];
const unsupportedBlendModeLayer = unsupportedBlendModeCase?.layers[0];
if (unsupportedBlendModeCase === undefined || unsupportedBlendModeLayer === undefined) {
  fail('layer preview/export parity requires at least one layer fixture');
}

const unsupportedBlendModeManifest = {
  cases: [
    {
      ...unsupportedBlendModeCase,
      layers: [
        {
          ...unsupportedBlendModeLayer,
          blendMode: 'hard_light',
        },
        ...unsupportedBlendModeCase.layers.slice(1),
      ],
    },
  ],
  version: 1,
};

if (manifestSchema.safeParse(unsupportedBlendModeManifest).success) {
  fail('layer preview/export parity accepted unsupported blend mode');
}

console.log(`layer preview/export parity ok (${manifest.cases.length})`);
