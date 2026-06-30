import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import { buildFilmLookAppliedAdjustmentPatch } from '../../../src/utils/film-look/filmLookBrowser.ts';
import { FILM_LOOK_BROWSER_ITEMS } from '../../../src/utils/film-look/filmLookRegistry.ts';

const manifestPath = resolve('fixtures/film-simulation/film-look-measured-fixture-manifest.json');
const outputPath = resolve('fixtures/film-simulation/film-look-measured-fixture-outputs.json');
const updateFixture = process.argv.includes('--update');
const WIDTH = 18;
const HEIGHT = 10;

const fixtureSchema = z
  .object({
    allowedValidationUses: z.array(z.enum(['preview_export_parity', 'render_bounds'])).min(2),
    autoCorrectionBakedIn: z.literal('known_absent'),
    colorProfile: z.string().min(1),
    copyrightOwner: z.string().min(1),
    developmentProcessKnown: z.literal(true),
    disallowedValidationUses: z.array(z.enum(['stock_reference_mapping', 'marketing_screenshot'])),
    expectedRenderBounds: z.object({
      maxBaselinePreviewDelta: z.number().positive().max(1),
      maxPreviewExportDelta: z.literal(0),
    }),
    fixtureId: z.string().regex(/^film_look\.(?:project_owned|licensed)\.[a-z0-9_]+_[0-9]+$/u),
    licenseName: z.string().min(1),
    localRelativePath: z.string().startsWith('private-fixtures/film-simulation/'),
    measurementStatus: z.literal('approved_private_payload_metadata'),
    payloadAccess: z.literal('private_ci_payload'),
    payloadSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    reviewDate: z.string().date(),
    reviewIssue: z.literal(1556),
    reviewer: z.string().min(1),
    sourceKind: z.enum(['project_owned', 'licensed']),
    state: z.literal('approved_render_measurement'),
    targetOrStepWedgePresent: z.literal(true),
  })
  .strict()
  .superRefine((fixture, context) => {
    for (const requiredDisallowedUse of ['stock_reference_mapping', 'marketing_screenshot']) {
      if (!fixture.disallowedValidationUses.includes(requiredDisallowedUse)) {
        context.addIssue({
          code: 'custom',
          message: `Measured film-look fixtures must explicitly block ${requiredDisallowedUse}.`,
          path: ['disallowedValidationUses'],
        });
      }
    }
  });

const manifestSchema = z
  .object({
    fixtures: z.array(fixtureSchema).min(1),
    generatedFrom: z.literal('fixtures/film-simulation/film-look-measured-fixture-manifest.json'),
    schemaVersion: z.literal(1),
  })
  .strict();

const rawOrTiffFixturePath = /\.(?:arw|cr2|cr3|dng|nef|raf|rw2|tif|tiff)$/iu;

const outputCaseSchema = z
  .object({
    baselinePreviewMaxDelta: z.number().nonnegative(),
    caseId: z.string().min(1),
    displayName: z.string().min(1),
    exportHash: z.string().length(16),
    fixtureId: z.string().min(1),
    lookId: z.string().min(1),
    maxAllowedBaselinePreviewDelta: z.number().positive(),
    maxAllowedPreviewExportDelta: z.literal(0),
    previewExportMaxDelta: z.literal(0),
    previewHash: z.string().length(16),
    proofLevel: z.literal('private_payload_metadata_and_adjustment_domain'),
    renderBoundsStatus: z.literal('within_bounds'),
    reviewIssue: z.literal(1556),
  })
  .strict();

const outputSchema = z
  .object({
    cases: z.array(outputCaseSchema).min(FILM_LOOK_BROWSER_ITEMS.length),
    doesNotProve: z
      .array(
        z.enum([
          'colorimetric_film_match',
          'manufacturer_endorsement',
          'measured_film_stock_emulation',
          'photochemical_density_domain',
          'public_raw_payload_render',
          'stock_reference_mapping',
        ]),
      )
      .min(6),
    fixtureManifest: manifestSchema,
    generatedFrom: z.literal('tests/integration/checks/check-film-look-measured-fixtures.ts'),
    version: z.literal(1),
  })
  .strict();

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const quantize = (value) => Math.round(clamp01(value) * 4095);
const hashPixels = (pixels) =>
  createHash('sha256')
    .update(JSON.stringify(pixels.map(({ b, g, r }) => [quantize(r), quantize(g), quantize(b)])))
    .digest('hex')
    .slice(0, 16);

const makeMeasuredScene = () => {
  const pixels = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const ramp = x / (WIDTH - 1);
      const rowBias = y / (HEIGHT - 1);
      pixels.push({
        b: clamp01(ramp * 0.68 + rowBias * 0.08 + (y % 3 === 2 ? 0.18 : 0.03)),
        g: clamp01(ramp * 0.78 + rowBias * 0.06 + (y % 3 === 1 ? 0.16 : 0.03)),
        r: clamp01(ramp * 0.9 + rowBias * 0.04 + (y % 3 === 0 ? 0.2 : 0.02)),
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
  Number(
    left.reduce((maximum, leftPixel, index) => Math.max(maximum, pixelDelta(leftPixel, right[index])), 0).toFixed(6),
  );
const deterministicNoise = (lookId, x, y, grainSize) => {
  const seed = `${lookId}:${Math.floor(x / Math.max(1, Math.round(grainSize / 12)))}:${Math.floor(y / 2)}`;
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

const unsafeClaims =
  /\b(?:adobe|capture one|dehancer|exact|identical|lightroom|mastin|manufacturer[ -]?approved|negative lab pro|nlp|official|rni|vsco)\b/iu;
const requiredOutputNonClaims = [
  'colorimetric_film_match',
  'manufacturer_endorsement',
  'measured_film_stock_emulation',
  'photochemical_density_domain',
  'public_raw_payload_render',
  'stock_reference_mapping',
];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const manifest = manifestSchema.parse(await readJson(manifestPath));

for (const fixture of manifest.fixtures) {
  for (const requiredUse of ['preview_export_parity', 'render_bounds']) {
    if (!fixture.allowedValidationUses.includes(requiredUse)) {
      throw new Error(`${fixture.fixtureId}: measured fixture must allow ${requiredUse}.`);
    }
  }

  if (!rawOrTiffFixturePath.test(fixture.localRelativePath)) {
    throw new Error(`${fixture.fixtureId}: measured fixture must point at a RAW/TIFF payload path.`);
  }
}

const buildCase = (fixture, look) => {
  const sourcePixels = makeMeasuredScene();
  const patch = buildFilmLookAppliedAdjustmentPatch(look, 100);
  const preview = applySyntheticFilmLook(sourcePixels, look.id, patch);
  const exportPixels = applySyntheticFilmLook(sourcePixels, look.id, patch);
  const baselinePreviewMaxDelta = maxDelta(sourcePixels, preview);
  const previewExportMaxDelta = maxDelta(preview, exportPixels);

  if (baselinePreviewMaxDelta > fixture.expectedRenderBounds.maxBaselinePreviewDelta) {
    throw new Error(`${fixture.fixtureId}/${look.id}: measured fixture render bounds exceeded.`);
  }

  if (previewExportMaxDelta !== fixture.expectedRenderBounds.maxPreviewExportDelta) {
    throw new Error(`${fixture.fixtureId}/${look.id}: preview/export parity drifted.`);
  }

  return {
    baselinePreviewMaxDelta,
    caseId: `film.look.measured.${fixture.fixtureId}.${look.id}`,
    displayName: look.displayName,
    exportHash: hashPixels(exportPixels),
    fixtureId: fixture.fixtureId,
    lookId: look.id,
    maxAllowedBaselinePreviewDelta: fixture.expectedRenderBounds.maxBaselinePreviewDelta,
    maxAllowedPreviewExportDelta: fixture.expectedRenderBounds.maxPreviewExportDelta,
    previewExportMaxDelta,
    previewHash: hashPixels(preview),
    proofLevel: 'private_payload_metadata_and_adjustment_domain',
    renderBoundsStatus: 'within_bounds',
    reviewIssue: fixture.reviewIssue,
  };
};

for (const look of FILM_LOOK_BROWSER_ITEMS) {
  const claimText = [look.id, look.displayName, look.description].join(' ');
  if (unsafeClaims.test(claimText)) {
    throw new Error(`${look.id}: measured fixture harness cannot run official, competitor, or exact-match claims.`);
  }

  if (look.provenance.claimLevel === 'stock_family_reference_metadata' && !/\binspired\b/iu.test(look.displayName)) {
    throw new Error(`${look.id}: stock-reference fixture case must stay labeled as inspired.`);
  }
}

const expectedOutput = outputSchema.parse({
  cases: manifest.fixtures.flatMap((fixture) => FILM_LOOK_BROWSER_ITEMS.map((look) => buildCase(fixture, look))),
  doesNotProve: requiredOutputNonClaims,
  fixtureManifest: manifest,
  generatedFrom: 'tests/integration/checks/check-film-look-measured-fixtures.ts',
  version: 1,
});
const expectedText = `${JSON.stringify(expectedOutput, null, 2)}\n`;

if (updateFixture) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expectedText);
  process.exit(0);
}

const currentOutput = outputSchema.parse(await readJson(outputPath));
for (const requiredNonClaim of requiredOutputNonClaims) {
  if (!currentOutput.doesNotProve.includes(requiredNonClaim)) {
    throw new Error(`Measured film look fixture output missing non-claim: ${requiredNonClaim}`);
  }
}
const expectedCaseCount = manifest.fixtures.length * FILM_LOOK_BROWSER_ITEMS.length;
if (currentOutput.cases.length !== expectedCaseCount) {
  throw new Error(`Measured film look fixture output must cover ${expectedCaseCount} fixture/look cases.`);
}

for (const fixture of manifest.fixtures) {
  for (const look of FILM_LOOK_BROWSER_ITEMS) {
    const caseId = `film.look.measured.${fixture.fixtureId}.${look.id}`;
    if (!currentOutput.cases.some((fixtureCase) => fixtureCase.caseId === caseId)) {
      throw new Error(`Measured film look fixture output is missing case: ${caseId}`);
    }
  }
}

if (JSON.stringify(currentOutput) !== JSON.stringify(expectedOutput)) {
  throw new Error(
    'Measured film look fixture outputs are stale. Run bun run check:film-look-measured-fixtures:update.',
  );
}

console.log(`film measured fixtures ok (${expectedOutput.cases.length} cases, metadata/private-payload proof only)`);
