import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';
import { proofContractSchema } from '../../../src/schemas/proofLevelSemanticsSchemas.ts';
import { buildFilmLookAppliedAdjustmentPatch } from '../../../src/utils/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/filmLookRegistry.ts';

const MANIFEST_PATH = resolve('fixtures/film-simulation/film-look-preview-export-parity.json');
const updateFixture = process.argv.includes('--update');
const WIDTH = 18;
const HEIGHT = 10;

const caseIds = [
  'film_look.generic.warm_print.v1',
  'film_look.generic.mono_silver.v1',
  'film_look.generic.punch_color.v1',
];

const parityCaseSchema = z.object({
  baselinePreviewMaxDelta: z.number().positive(),
  caseId: z.string(),
  displayName: z.string(),
  exportHash: z.string().length(16),
  lookId: z.string(),
  maxAllowedPreviewExportDelta: z.literal(0),
  previewExportMaxDelta: z.literal(0),
  previewHash: z.string().length(16),
  strength: z.number().int().min(0).max(100),
});
const manifestSchema = z.object({
  cases: z.array(parityCaseSchema).length(caseIds.length),
  doesNotProve: z.array(z.string()).nonempty(),
  fixtureInput: z.object({
    colorSpace: z.literal('synthetic-display-linear-rgb'),
    kind: z.literal('synthetic-film-look-preview-export-parity'),
    scene: z.literal('ramp-color-chips-highlight-edge'),
  }),
  proofEntrypoints: z
    .object({
      export: z.literal('applySyntheticFilmLook'),
      preview: z.literal('applySyntheticFilmLook'),
    })
    .strict(),
  proofLevel: z.literal('synthetic_shared_preview_export_match'),
  runtimeStatus: z.literal('synthetic_shared_renderer_preview_export_match'),
  generatedFrom: z.literal('tests/integration/checks/check-film-look-preview-export-parity.ts'),
  version: z.literal(1),
});

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const quantize = (value) => Math.round(clamp01(value) * 4095);
const hashPixels = (pixels) =>
  createHash('sha256')
    .update(JSON.stringify(pixels.map(({ b, g, r }) => [quantize(r), quantize(g), quantize(b)])))
    .digest('hex')
    .slice(0, 16);

const makeSyntheticScene = () => {
  const pixels = [];

  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ramp = x / (WIDTH - 1);
      const chip = y % 3;
      const edgeBoost = x >= WIDTH - 4 && y >= 2 && y <= HEIGHT - 3 ? 0.28 : 0;
      pixels.push({
        b: clamp01(ramp * 0.72 + (chip === 2 ? 0.2 : 0.04) + edgeBoost),
        g: clamp01(ramp * 0.82 + (chip === 1 ? 0.18 : 0.03) + edgeBoost),
        r: clamp01(ramp * 0.92 + (chip === 0 ? 0.22 : 0.02) + edgeBoost),
        x,
        y,
      });
    }
  }

  return pixels;
};

const pixelDelta = (left, right) =>
  Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b));
const maxDelta = (left, right) =>
  left.reduce((maximum, leftPixel, index) => Math.max(maximum, pixelDelta(leftPixel, right[index])), 0);
const deterministicNoise = (lookId, x, y, grainSize) => {
  const cell = Math.max(1, Math.round(grainSize / 12));
  const seed = `${lookId}:${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  const hash = createHash('sha256').update(seed).digest();
  return hash[0] / 127.5 - 1;
};

const applySyntheticFilmLook = (sourcePixels, lookId, patch) =>
  sourcePixels.map((pixel) => {
    const temperature = (patch.temperature ?? 0) / 100;
    const contrast = (patch.contrast ?? 0) / 100;
    const highlights = (patch.highlights ?? 0) / 100;
    const shadows = (patch.shadows ?? 0) / 100;
    const blacks = (patch.blacks ?? 0) / 100;
    const saturation = (patch.saturation ?? 0) / 100;
    const glow = (patch.glowAmount ?? 0) / 100;
    const grainAmount = (patch.grainAmount ?? 0) / 100;
    const grainSize = patch.grainSize ?? 25;
    let r = pixel.r + temperature * 0.08;
    let g = pixel.g + temperature * 0.015;
    let b = pixel.b - temperature * 0.07;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const highlightMask = clamp01((luma - 0.58) / 0.42);
    const shadowMask = clamp01((0.42 - luma) / 0.42);

    r =
      (r - 0.5) * (1 + contrast) +
      0.5 +
      highlights * highlightMask * 0.18 +
      shadows * shadowMask * 0.14 +
      blacks * 0.08;
    g =
      (g - 0.5) * (1 + contrast) +
      0.5 +
      highlights * highlightMask * 0.18 +
      shadows * shadowMask * 0.14 +
      blacks * 0.08;
    b =
      (b - 0.5) * (1 + contrast) +
      0.5 +
      highlights * highlightMask * 0.18 +
      shadows * shadowMask * 0.14 +
      blacks * 0.08;

    const saturatedLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = saturatedLuma + (r - saturatedLuma) * (1 + saturation);
    g = saturatedLuma + (g - saturatedLuma) * (1 + saturation);
    b = saturatedLuma + (b - saturatedLuma) * (1 + saturation);

    const glowBoost = glow * highlightMask * 0.08;
    const grain = deterministicNoise(lookId, pixel.x, pixel.y, grainSize) * grainAmount * 0.035;

    return {
      b: clamp01(b + glowBoost + grain),
      g: clamp01(g + glowBoost + grain),
      r: clamp01(r + glowBoost + grain),
      x: pixel.x,
      y: pixel.y,
    };
  });

const runCase = (look) => {
  const sourcePixels = makeSyntheticScene();
  const patch = buildFilmLookAppliedAdjustmentPatch(look, 100);
  const preview = applySyntheticFilmLook(sourcePixels, look.id, patch);
  const exportPixels = applySyntheticFilmLook(sourcePixels, look.id, patch);
  const previewExportMaxDelta = maxDelta(preview, exportPixels);

  return {
    baselinePreviewMaxDelta: Number(maxDelta(sourcePixels, preview).toFixed(6)),
    caseId: `film.look.preview_export.${look.id.replaceAll('_', '-')}`,
    displayName: look.displayName,
    exportHash: hashPixels(exportPixels),
    lookId: look.id,
    maxAllowedPreviewExportDelta: 0,
    previewExportMaxDelta,
    previewHash: hashPixels(preview),
    strength: 100,
  };
};

const buildManifest = () => ({
  cases: caseIds.map((caseId) => {
    const look = FILM_LOOK_BROWSER_ITEMS.find((item) => item.id === caseId);
    if (look === undefined) {
      throw new Error(`Missing film look parity case source: ${caseId}`);
    }

    return runCase(look);
  }),
  doesNotProve: [
    'independent_preview_export_paths',
    'real_raw_quality',
    'gpu_parity',
    'measured_film_stock_emulation',
    'photochemical_density_domain',
  ],
  fixtureInput: {
    colorSpace: 'synthetic-display-linear-rgb',
    kind: 'synthetic-film-look-preview-export-parity',
    scene: 'ramp-color-chips-highlight-edge',
  },
  proofEntrypoints: {
    export: 'applySyntheticFilmLook',
    preview: 'applySyntheticFilmLook',
  },
  proofLevel: 'synthetic_shared_preview_export_match',
  runtimeStatus: 'synthetic_shared_renderer_preview_export_match',
  generatedFrom: 'tests/integration/checks/check-film-look-preview-export-parity.ts',
  version: 1,
});

const expectedManifestObject = manifestSchema.parse(buildManifest());
proofContractSchema.parse(expectedManifestObject);
const expectedManifest = `${JSON.stringify(expectedManifestObject, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, expectedManifest);
  process.exit(0);
}

let currentManifest;
try {
  currentManifest = await readFile(MANIFEST_PATH, 'utf8');
} catch (error) {
  throw new Error(
    `Film preview/export parity fixture is missing. Run bun run check:film-look-preview-export-parity:update. Cause: ${error}`,
  );
}

const currentManifestObject = manifestSchema.parse(JSON.parse(currentManifest));

if (JSON.stringify(currentManifestObject) !== JSON.stringify(expectedManifestObject)) {
  throw new Error(
    'Film preview/export parity fixture is stale. Run bun run check:film-look-preview-export-parity:update.',
  );
}

console.log(`Film look preview/export parity ok (${caseIds.length} synthetic cases).`);
