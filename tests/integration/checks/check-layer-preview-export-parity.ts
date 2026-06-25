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
import { renderLayerPreviewStack as renderPackageLayerPreviewStack } from '../../../packages/rawengine-schema/src/layerBlendRuntime.ts';
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

const retouchSourceSchema = z
  .object({
    alignmentErrorPx: z.number().min(0).optional(),
    featherRadiusPx: z.number().min(0).max(4096).optional(),
    radiusPx: z.number().positive().max(4096).optional(),
    retouchMode: z.enum(['clone', 'heal']).optional(),
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
  .strict();

const retouchRemoveSourceSchema = z
  .object({
    featherRadiusPx: z.number().min(0).max(4096).optional(),
    generator: z.literal('local_patch_fill_v1'),
    generatorVersion: z.literal(1),
    radiusPx: z.number().positive().max(4096).optional(),
    resolvedSourcePoint: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    searchRadiusMultiplier: z.number().min(1).max(12),
    seed: z.number().int().min(0).max(0xffffffff),
    status: z.enum(['fallback_unchanged', 'needs_regeneration', 'ready', 'stale']).optional(),
    targetMaskId: z.string().trim().min(1),
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
    retouchCloneSource: retouchSourceSchema.optional(),
    retouchRemoveSource: retouchRemoveSourceSchema.optional(),
    visible: z.boolean(),
  })
  .strict();

const sidecarLayerSchema = z
  .object({
    blendMode: layerMaskBlendModeV1Schema.extract(['multiply', 'normal', 'overlay', 'screen', 'soft_light']),
    id: z.string().trim().min(1),
    maskPersisted: z.boolean(),
    opacity: z.number().min(0).max(1),
    retouchCloneSource: retouchSourceSchema.optional(),
    retouchRemoveSource: retouchRemoveSourceSchema.optional(),
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

const resolvedRemoveSourceSchema = z
  .object({
    layerId: z.string().trim().min(1),
    outputSampleHash: z
      .string()
      .regex(/^fnv1a32:[0-9a-f]{8}$/u)
      .optional(),
    resolvedSourcePoint: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    sourceSampleHash: z
      .string()
      .regex(/^fnv1a32:[0-9a-f]{8}$/u)
      .optional(),
    status: z.enum(['fallback_unchanged', 'ready']),
    targetMaskId: z.string().trim().min(1),
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

const stableJson = (value: unknown) =>
  JSON.stringify(value, (_key, nestedValue) => {
    if (nestedValue === null || typeof nestedValue !== 'object' || Array.isArray(nestedValue)) return nestedValue;
    return Object.fromEntries(
      Object.entries(nestedValue).toSorted(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)),
    );
  });

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

const withRetouchMode = (fixture, mode) => ({
  ...fixture,
  layers: fixture.layers.map((layer) =>
    layer.retouchCloneSource === undefined
      ? layer
      : {
          ...layer,
          retouchCloneSource: {
            ...layer.retouchCloneSource,
            retouchMode: mode,
          },
        },
  ),
});

const toRenderInput = (fixture) => ({
  basePixels: fixture.basePixels,
  height: fixture.height,
  layers: fixture.layers,
  width: fixture.width,
});

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
  const retouchSource = cloneLayer.retouchCloneSource;
  if (retouchSource === undefined) throw new Error(`${fixture.id}: missing retouch source payload`);
  if (retouchSource.retouchMode !== 'heal') fail(`${fixture.id}: missing heal retouch mode`);
  if (retouchSource.radiusPx !== 32 || retouchSource.featherRadiusPx !== 16) {
    fail(`${fixture.id}: heal radius/feather metadata missing`);
  }

  const sidecarLayerIds = fixture.sidecarLayerStack.layers.map((layer) => layer.id);
  const fixtureLayerIds = fixture.layers.map((layer) => layer.id);
  if (JSON.stringify(sidecarLayerIds) !== JSON.stringify(fixtureLayerIds)) {
    fail(`${fixture.id}: sidecar layer order mismatch`);
  }

  const preview = renderLayerPreviewStack(fixture);
  const exported = renderLayerExportStack(fixture);
  const headless = renderLayerHeadlessStack(fixture);
  const packagePreview = renderPackageLayerPreviewStack(toRenderInput(fixture));
  const previewHash = hashPixels(preview.pixels);
  const exportHash = hashPixels(exported.pixels);
  const headlessHash = hashPixels(headless.pixels);
  const packagePreviewHash = hashPixels(packagePreview.pixels);
  if (previewHash !== exportHash) {
    fail(`${fixture.id}: preview/export pixel hash mismatch`, [previewHash, exportHash]);
  }
  if (previewHash !== headlessHash) {
    fail(`${fixture.id}: preview/headless pixel hash mismatch`, [previewHash, headlessHash]);
  }
  if (previewHash !== packagePreviewHash) {
    fail(`${fixture.id}: app/package pixel hash mismatch`, [previewHash, packagePreviewHash]);
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
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(packagePreview.coverageByLayer)) {
    fail(`${fixture.id}: app/package coverage mismatch`);
  }
  if (JSON.stringify(preview.coverageByLayer) !== JSON.stringify(fixture.expectedCoverageByLayer)) {
    fail(`${fixture.id}: expected coverage mismatch`);
  }

  const clonePreviewHash = hashPixels(renderLayerPreviewStack(withRetouchMode(fixture, 'clone')).pixels);
  if (clonePreviewHash === previewHash) {
    fail(`${fixture.id}: heal retouch render should differ from clone render`);
  }
  const smallRadiusFixture = {
    ...fixture,
    layers: fixture.layers.map((layer) =>
      layer.retouchCloneSource === undefined
        ? layer
        : {
            ...layer,
            retouchCloneSource: {
              ...layer.retouchCloneSource,
              featherRadiusPx: 0,
              radiusPx: 0.75,
            },
          },
    ),
  };
  const smallRadiusRetouchCoverage = renderLayerPreviewStack(smallRadiusFixture).coverageByLayer.find(
    (layer) => layer.id === cloneLayer.id,
  );
  if (smallRadiusRetouchCoverage?.touchedPixels !== 1) {
    fail(`${fixture.id}: heal radius should constrain retouch coverage`, [
      `touchedPixels=${smallRadiusRetouchCoverage?.touchedPixels ?? 'missing'}`,
    ]);
  }

  const sidecarRoundtrip = sidecarLayerStackSchema.parse(JSON.parse(JSON.stringify(fixture.sidecarLayerStack)));
  if (sidecarRoundtrip.storage !== 'sidecar_artifact') fail(`${fixture.id}: sidecar storage mismatch`);
  if (!sidecarRoundtrip.layers.some((layer) => layer.retouchCloneSource?.sourcePoint.x === 0)) {
    fail(`${fixture.id}: sidecar clone source linkage missing`);
  }
  if (!sidecarRoundtrip.layers.some((layer) => layer.retouchCloneSource?.retouchMode === 'heal')) {
    fail(`${fixture.id}: sidecar heal metadata missing`);
  }

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

const removeFixture = {
  basePixels: Array.from({ length: 25 }, (_, index) => ({
    b: 40 + ((index * 7) % 31),
    g: 30 + ((index * index * 3) % 37),
    r: 20 + ((index * 11 + index * index) % 53),
  })),
  height: 5,
  layers: [
    {
      blendMode: 'normal',
      id: 'remove-local-fill',
      maskAlpha: Array.from({ length: 25 }, (_, index) => (index === 12 || index === 13 ? 1 : 0)),
      name: 'Remove local fill',
      opacity: 1,
      retouchRemoveSource: {
        featherRadiusPx: 0,
        generator: 'local_patch_fill_v1',
        generatorVersion: 1,
        radiusPx: 1,
        resolvedSourcePoint: { x: 0.25, y: 0.5 },
        searchRadiusMultiplier: 4,
        seed: 0,
        status: 'ready',
        targetMaskId: 'remove-target',
      },
      visible: true,
    },
  ],
  width: 5,
} satisfies Parameters<typeof renderLayerPreviewStack>[0];
const removePreview = renderLayerPreviewStack(removeFixture);
const removeExport = renderLayerExportStack(removeFixture);
const removePackage = renderPackageLayerPreviewStack(removeFixture);
const expectedResolvedRemoveSource = z.array(resolvedRemoveSourceSchema).parse([
  {
    layerId: 'remove-local-fill',
    resolvedSourcePoint: { x: 0.25, y: 0.5 },
    sourceSampleHash: 'fnv1a32:90ed1b36',
    outputSampleHash: 'fnv1a32:9b253abc',
    status: 'ready',
    targetMaskId: 'remove-target',
  },
]);
const removePreviewHash = hashPixels(removePreview.pixels);
if (removePreviewHash !== hashPixels(removeExport.pixels) || removePreviewHash !== hashPixels(removePackage.pixels)) {
  fail('remove-local-fill: preview/export/package hash mismatch');
}
if (removePreviewHash === hashPixels(removeFixture.basePixels)) {
  fail('remove-local-fill: remove layer did not alter target pixels');
}
if (
  stableJson(removePreview.resolvedRemoveSources) !== stableJson(expectedResolvedRemoveSource) ||
  stableJson(removeExport.resolvedRemoveSources) !== stableJson(expectedResolvedRemoveSource) ||
  stableJson(removePackage.resolvedRemoveSources) !== stableJson(expectedResolvedRemoveSource)
) {
  fail('remove-local-fill: resolved remove source metadata mismatch');
}

const transformedRetouchBasePixels = Array.from({ length: 25 }, (_, index) => ({
  b: 20 + index * 3,
  g: 10 + index * 5,
  r: index * 10,
}));
const transformedRetouchBase = {
  basePixels: transformedRetouchBasePixels,
  height: 5,
  layers: [
    {
      blendMode: 'normal',
      id: 'retouch-transform',
      maskAlpha: Array.from({ length: 25 }, () => 0),
      name: 'Retouch transform',
      opacity: 1,
      retouchCloneSource: {
        featherRadiusPx: 0,
        radiusPx: 4,
        retouchMode: 'clone',
        rotationDegrees: 0,
        scale: 1,
        sourcePoint: { x: 0.5, y: 0.5 },
        targetPoint: { x: 0.5, y: 0.5 },
      },
      visible: true,
    },
  ],
  width: 5,
} satisfies Parameters<typeof renderLayerPreviewStack>[0];
const transformedRetouchLayer = transformedRetouchBase.layers[0];
if (transformedRetouchLayer === undefined) {
  fail('retouch-transform: missing layer');
}
const transformedRetouchSource = transformedRetouchLayer.retouchCloneSource;
if (transformedRetouchSource === undefined) {
  fail('retouch-transform: missing clone source');
}

type LayerPreviewInput = Parameters<typeof renderLayerPreviewStack>[0];
type RetouchCloneSource = NonNullable<LayerPreviewInput['layers'][number]['retouchCloneSource']>;

const renderTransformedRetouchPixel = (retouchCloneSource: RetouchCloneSource, targetIndex: number) => {
  const maskAlpha = Array.from({ length: 25 }, (_, index) => (index === targetIndex ? 1 : 0));
  return renderLayerPreviewStack({
    ...transformedRetouchBase,
    layers: [
      {
        ...transformedRetouchLayer,
        maskAlpha,
        retouchCloneSource,
      },
    ],
  }).pixels[targetIndex];
};

const rotatedRetouchPixel = renderTransformedRetouchPixel({ ...transformedRetouchSource, rotationDegrees: 90 }, 13);
const rotatedExpectedPixel = transformedRetouchBasePixels[7];
if (JSON.stringify(rotatedRetouchPixel) !== JSON.stringify(rotatedExpectedPixel)) {
  fail('retouch-transform: rotation should sample canonical image-space source pixel', [
    `actual=${JSON.stringify(rotatedRetouchPixel)}`,
    `expected=${JSON.stringify(rotatedExpectedPixel)}`,
  ]);
}

const scaledRetouchPixel = renderTransformedRetouchPixel({ ...transformedRetouchSource, scale: 2 }, 14);
const scaledExpectedPixel = transformedRetouchBasePixels[13];
if (JSON.stringify(scaledRetouchPixel) !== JSON.stringify(scaledExpectedPixel)) {
  fail('retouch-transform: scale should sample canonical image-space source pixel', [
    `actual=${JSON.stringify(scaledRetouchPixel)}`,
    `expected=${JSON.stringify(scaledExpectedPixel)}`,
  ]);
}

const bilinearRetouchPixel = renderTransformedRetouchPixel({ ...transformedRetouchSource, scale: 2 }, 13);
const bilinearExpectedPixel = {
  b: 58,
  g: 73,
  r: 125,
};
if (JSON.stringify(bilinearRetouchPixel) !== JSON.stringify(bilinearExpectedPixel)) {
  fail('retouch-transform: scale should bilinearly sample subpixel source points', [
    `actual=${JSON.stringify(bilinearRetouchPixel)}`,
    `expected=${JSON.stringify(bilinearExpectedPixel)}`,
  ]);
}

const nonSquareRetouchBasePixels = Array.from({ length: 35 }, (_, index) => ({
  b: 15 + index * 2,
  g: 25 + index * 3,
  r: 35 + index * 4,
}));
const nonSquareRetouchFixture = {
  basePixels: nonSquareRetouchBasePixels,
  height: 5,
  layers: [
    {
      blendMode: 'normal',
      id: 'retouch-transform-non-square',
      maskAlpha: Array.from({ length: 35 }, (_, index) => (index === 17 || index === 18 ? 1 : 0)),
      name: 'Retouch transform non-square',
      opacity: 1,
      retouchCloneSource: {
        featherRadiusPx: 0,
        radiusPx: 4,
        retouchMode: 'heal',
        rotationDegrees: 37,
        scale: 1.6,
        sourcePoint: { x: 0.25, y: 0.35 },
        targetPoint: { x: 0.62, y: 0.5 },
      },
      visible: true,
    },
  ],
  width: 7,
} satisfies Parameters<typeof renderLayerPreviewStack>[0];
const nonSquarePreview = renderLayerPreviewStack(nonSquareRetouchFixture);
const nonSquareExport = renderLayerExportStack(nonSquareRetouchFixture);
const nonSquareHeadless = renderLayerHeadlessStack(nonSquareRetouchFixture);
const nonSquarePackage = renderPackageLayerPreviewStack(nonSquareRetouchFixture);
const nonSquarePreviewHash = hashPixels(nonSquarePreview.pixels);
const expectedNonSquareHash = 'sha256:503c750664a6bf7bd96bba64d3ca0a9de02af7af6678cff6fc8630792fdb00b5';
if (
  nonSquarePreviewHash !== hashPixels(nonSquareExport.pixels) ||
  nonSquarePreviewHash !== hashPixels(nonSquareHeadless.pixels) ||
  nonSquarePreviewHash !== hashPixels(nonSquarePackage.pixels)
) {
  fail('retouch-transform-non-square: preview/export/headless/package hashes diverged');
}
if (nonSquarePreviewHash === hashPixels(nonSquareRetouchBasePixels)) {
  fail('retouch-transform-non-square: transform did not alter the fixture pixels');
}
if (nonSquarePreviewHash !== expectedNonSquareHash) {
  fail('retouch-transform-non-square: expected hash mismatch', [nonSquarePreviewHash, expectedNonSquareHash]);
}
if (JSON.stringify(nonSquarePreview.coverageByLayer) !== JSON.stringify(nonSquarePackage.coverageByLayer)) {
  fail('retouch-transform-non-square: app/package coverage mismatch');
}

console.log(`layer preview/export parity ok (${manifest.cases.length})`);
