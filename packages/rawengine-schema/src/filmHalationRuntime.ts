import { z } from 'zod';

const SCHEMA_VERSION = 1;
const ALGORITHM_ID = 'halation.conservative.v1';
const WARM_ENDPOINT_UNIT_LUMA = {
  b: 0.23004999999999998,
  g: 0.7761349999999999,
  r: 2.01498,
} as const;
const LUMA_COEFFICIENTS = {
  b: 0.0722,
  g: 0.7152,
  r: 0.2126,
} as const;

export const filmHalationRuntimeWarningCodeV1Schema = z.enum([
  'HALATION_PARAMETERS_OUTSIDE_VALIDATED_RANGE',
  'HALATION_NEW_OUTPUT_CLIP',
  'HALATION_OUTPUT_GAMUT',
  'HALATION_EXCESSIVE_NEUTRAL_SHIFT',
  'HALATION_BROAD_COVERAGE',
  'HALATION_NONFINITE_OUTPUT',
]);

export const filmHalationPixelV1Schema = z
  .object({
    b: z.number().min(0).max(4),
    g: z.number().min(0).max(4),
    r: z.number().min(0).max(4),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const filmHalationControlsV1Schema = z
  .object({
    amount: z.number().min(0).max(100),
    enabled: z.boolean(),
    highlightThresholdEv: z.number().min(0.5).max(6),
    sigmaShortEdgeFraction: z.number().min(0).max(0.01),
    warmth: z.number().min(0).max(0.75),
  })
  .strict();

export const filmHalationRuntimeInputV1Schema = z
  .object({
    controls: filmHalationControlsV1Schema,
    fullResShortEdgePx: z.number().int().min(1),
    imageId: z.string().trim().min(1),
    pixels: z.array(filmHalationPixelV1Schema).min(1),
    previewShortEdgePx: z.number().int().min(1).optional(),
    sourceContentHash: z.string().trim().min(1),
    workingSpace: z.enum(['linear_srgb_d65', 'linear_display_p3_d65']).default('linear_srgb_d65'),
  })
  .strict()
  .superRefine((input, context) => {
    const sigmaPx = input.controls.sigmaShortEdgeFraction * input.fullResShortEdgePx;
    const hardSigmaPxLimit = Math.min(input.fullResShortEdgePx * 0.01, 128);
    if (sigmaPx > hardSigmaPxLimit) {
      context.addIssue({
        code: 'custom',
        message: 'Halation spread exceeds hard sigma limit.',
        path: ['controls', 'sigmaShortEdgeFraction'],
      });
    }
  });

export const filmHalationMaskSampleV1Schema = z
  .object({
    blurred: z.number().min(0).max(1),
    highlight: z.number().min(0).max(1),
    quantity: z.number().min(0).max(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const filmHalationRuntimeResultV1Schema = z
  .object({
    afterHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    beforeHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    changedPixels: z.number().int().nonnegative(),
    claimBoundary: z.literal('rgb_creative_approximation_not_physical_film_halation'),
    maskSamples: z.array(filmHalationMaskSampleV1Schema).min(1),
    metrics: z
      .object({
        broadCoverageRatio: z.number().min(0).max(1),
        changedPixelRatio: z.number().min(0).max(1),
        maxAbsDelta: z.number().min(0),
        maxLumaDelta: z.number(),
        neutralPatchMaxDelta: z.number().min(0),
        outputClipCount: z.number().int().nonnegative(),
      })
      .strict(),
    outputPixels: z.array(filmHalationPixelV1Schema).min(1),
    previewApproximation: z.boolean(),
    provenance: z
      .object({
        algorithmId: z.literal(ALGORITHM_ID),
        colorDomain: z.literal('working_linear_rgb'),
        constants: z
          .object({
            grayReferenceLuma: z.literal(0.18),
            lumaCoefficients: z
              .object({
                b: z.literal(LUMA_COEFFICIENTS.b),
                g: z.literal(LUMA_COEFFICIENTS.g),
                r: z.literal(LUMA_COEFFICIENTS.r),
              })
              .strict(),
            warmEndpointXyY: z.literal('0.46,0.40,1.0'),
          })
          .strict(),
        controls: filmHalationControlsV1Schema,
        edgeMode: z.literal('clamp_to_edge'),
        kernel: z.literal('gaussian_mask_only_reference'),
        referenceWhite: z.literal('D65'),
        renderStage: z.literal('late_working_linear_before_output_transform'),
        sigmaPx: z.number().min(0),
        workingSpace: z.enum(['linear_srgb_d65', 'linear_display_p3_d65']),
      })
      .strict(),
    runtimeStatus: z.literal('synthetic_cpu_reference_runtime_apply_capable'),
    schemaVersion: z.literal(SCHEMA_VERSION),
    warnings: z.array(filmHalationRuntimeWarningCodeV1Schema),
  })
  .strict();

export type FilmHalationControlsV1 = z.infer<typeof filmHalationControlsV1Schema>;
export type FilmHalationMaskSampleV1 = z.infer<typeof filmHalationMaskSampleV1Schema>;
export type FilmHalationPixelV1 = z.infer<typeof filmHalationPixelV1Schema>;
export type FilmHalationRuntimeInputV1 = z.infer<typeof filmHalationRuntimeInputV1Schema>;
export type FilmHalationRuntimeResultV1 = z.infer<typeof filmHalationRuntimeResultV1Schema>;
export type FilmHalationRuntimeWarningCodeV1 = z.infer<typeof filmHalationRuntimeWarningCodeV1Schema>;

export function applyFilmHalationRuntime(inputValue: FilmHalationRuntimeInputV1): FilmHalationRuntimeResultV1 {
  const input = filmHalationRuntimeInputV1Schema.parse(inputValue);
  const sourcePixels = input.pixels;
  const beforeHash = hashPixels(sourcePixels);
  const warnings = new Set<FilmHalationRuntimeWarningCodeV1>();
  collectParameterWarnings(input, warnings);

  if (!input.controls.enabled || input.controls.amount === 0) {
    return filmHalationRuntimeResultV1Schema.parse({
      afterHash: beforeHash,
      beforeHash,
      changedPixels: 0,
      claimBoundary: 'rgb_creative_approximation_not_physical_film_halation',
      maskSamples: sourcePixels.map((pixel) => ({ blurred: 0, highlight: 0, quantity: 0, x: pixel.x, y: pixel.y })),
      metrics: {
        broadCoverageRatio: 0,
        changedPixelRatio: 0,
        maxAbsDelta: 0,
        maxLumaDelta: 0,
        neutralPatchMaxDelta: 0,
        outputClipCount: 0,
      },
      outputPixels: sourcePixels,
      previewApproximation: isPreviewApproximation(input),
      provenance: buildProvenance(input),
      runtimeStatus: 'synthetic_cpu_reference_runtime_apply_capable',
      schemaVersion: SCHEMA_VERSION,
      warnings: [...warnings].sort(),
    });
  }

  const width = Math.max(...sourcePixels.map((pixel) => pixel.x)) + 1;
  const height = Math.max(...sourcePixels.map((pixel) => pixel.y)) + 1;
  const sigmaPx = resolveSigmaPx(input);
  const highlightMasks = sourcePixels.map((pixel) =>
    calculateHighlightMask(pixel, input.controls.highlightThresholdEv),
  );
  const blurredMasks = blurMask(sourcePixels, highlightMasks, width, height, sigmaPx);
  const quantityMasks = blurredMasks.map((blurred, index) =>
    clamp01(blurred * (1 - (highlightMasks[index] ?? 0)) ** 2),
  );
  const amountScale = (input.controls.amount / 100) * 0.08;
  const warmVector = resolveWarmVector(input.controls.warmth);
  const outputPixels = sourcePixels.map((pixel, index) =>
    applyHalationPixel(pixel, quantityMasks[index] ?? 0, amountScale, warmVector, warnings),
  );
  const metrics = calculateMetrics(sourcePixels, outputPixels, quantityMasks);

  if (metrics.outputClipCount > 0) warnings.add('HALATION_NEW_OUTPUT_CLIP');
  if (metrics.outputClipCount > 0) warnings.add('HALATION_OUTPUT_GAMUT');
  if (metrics.neutralPatchMaxDelta > 0.03) warnings.add('HALATION_EXCESSIVE_NEUTRAL_SHIFT');
  if (metrics.broadCoverageRatio > 0.45) warnings.add('HALATION_BROAD_COVERAGE');

  return filmHalationRuntimeResultV1Schema.parse({
    afterHash: hashPixels(outputPixels),
    beforeHash,
    changedPixels: countChangedPixels(sourcePixels, outputPixels),
    claimBoundary: 'rgb_creative_approximation_not_physical_film_halation',
    maskSamples: sourcePixels.map((pixel, index) => ({
      blurred: roundMetric(blurredMasks[index] ?? 0),
      highlight: roundMetric(highlightMasks[index] ?? 0),
      quantity: roundMetric(quantityMasks[index] ?? 0),
      x: pixel.x,
      y: pixel.y,
    })),
    metrics,
    outputPixels,
    previewApproximation: isPreviewApproximation(input),
    provenance: buildProvenance(input),
    runtimeStatus: 'synthetic_cpu_reference_runtime_apply_capable',
    schemaVersion: SCHEMA_VERSION,
    warnings: [...warnings].sort(),
  });
}

function collectParameterWarnings(
  input: FilmHalationRuntimeInputV1,
  warnings: Set<FilmHalationRuntimeWarningCodeV1>,
): void {
  const controls = input.controls;
  const sigmaPx = resolveSigmaPx(input);
  if (
    controls.amount > 30 ||
    controls.highlightThresholdEv < 1.5 ||
    controls.highlightThresholdEv > 3.5 ||
    controls.sigmaShortEdgeFraction < 0.0005 ||
    controls.sigmaShortEdgeFraction > 0.004 ||
    controls.warmth < 0.25 ||
    controls.warmth > 0.6 ||
    sigmaPx > 128
  ) {
    warnings.add('HALATION_PARAMETERS_OUTSIDE_VALIDATED_RANGE');
  }
}

function applyHalationPixel(
  pixel: FilmHalationPixelV1,
  quantity: number,
  amountScale: number,
  warmVector: { b: number; g: number; r: number },
  warnings: Set<FilmHalationRuntimeWarningCodeV1>,
): FilmHalationPixelV1 {
  const r = pixel.r + amountScale * quantity * warmVector.r;
  const g = pixel.g + amountScale * quantity * warmVector.g;
  const b = pixel.b + amountScale * quantity * warmVector.b;
  if (![r, g, b].every(Number.isFinite)) warnings.add('HALATION_NONFINITE_OUTPUT');

  return {
    b: roundChannel(b),
    g: roundChannel(g),
    r: roundChannel(r),
    x: pixel.x,
    y: pixel.y,
  };
}

function blurMask(
  pixels: ReadonlyArray<FilmHalationPixelV1>,
  masks: ReadonlyArray<number>,
  width: number,
  height: number,
  sigmaPx: number,
): number[] {
  if (sigmaPx <= 0.001) return masks.map(roundMetric);

  const radius = Math.max(1, Math.ceil(sigmaPx * 3));
  const maskByCoordinate = new Map<string, number>();
  for (const [index, pixel] of pixels.entries()) {
    maskByCoordinate.set(`${pixel.x}:${pixel.y}`, masks[index] ?? 0);
  }

  return pixels.map((pixel) => {
    let weightedSum = 0;
    let weightSum = 0;
    for (let y = pixel.y - radius; y <= pixel.y + radius; y += 1) {
      for (let x = pixel.x - radius; x <= pixel.x + radius; x += 1) {
        const clampedX = Math.min(width - 1, Math.max(0, x));
        const clampedY = Math.min(height - 1, Math.max(0, y));
        const distanceSquared = (x - pixel.x) ** 2 + (y - pixel.y) ** 2;
        const weight = Math.exp(-distanceSquared / (2 * sigmaPx ** 2));
        weightedSum += (maskByCoordinate.get(`${clampedX}:${clampedY}`) ?? 0) * weight;
        weightSum += weight;
      }
    }

    return roundMetric(weightSum === 0 ? 0 : weightedSum / weightSum);
  });
}

function calculateHighlightMask(pixel: FilmHalationPixelV1, thresholdEv: number): number {
  const luma = calculateLuma(pixel);
  const threshold = 0.18 * 2 ** thresholdEv;
  return smoothstep(threshold, threshold * 1.7, luma);
}

function calculateMetrics(
  before: ReadonlyArray<FilmHalationPixelV1>,
  after: ReadonlyArray<FilmHalationPixelV1>,
  quantities: ReadonlyArray<number>,
): FilmHalationRuntimeResultV1['metrics'] {
  let changedPixels = 0;
  let maxAbsDelta = 0;
  let maxLumaDelta = 0;
  let neutralPatchMaxDelta = 0;
  let outputClipCount = 0;
  let broadCoveragePixels = 0;

  for (let index = 0; index < before.length; index += 1) {
    const beforePixel = before[index];
    const afterPixel = after[index];
    if (beforePixel === undefined || afterPixel === undefined) continue;

    const deltas = [
      Math.abs(afterPixel.r - beforePixel.r),
      Math.abs(afterPixel.g - beforePixel.g),
      Math.abs(afterPixel.b - beforePixel.b),
    ];
    const pixelMax = Math.max(...deltas);
    if (pixelMax > 0) changedPixels += 1;
    if (
      Math.max(afterPixel.r, afterPixel.g, afterPixel.b) >= 1 &&
      Math.max(beforePixel.r, beforePixel.g, beforePixel.b) < 1
    ) {
      outputClipCount += 1;
    }
    if ((quantities[index] ?? 0) > 0.02) broadCoveragePixels += 1;
    if (
      Math.max(beforePixel.r, beforePixel.g, beforePixel.b) < 0.4 &&
      Math.min(beforePixel.r, beforePixel.g, beforePixel.b) > 0.08
    ) {
      neutralPatchMaxDelta = Math.max(neutralPatchMaxDelta, pixelMax);
    }

    maxAbsDelta = Math.max(maxAbsDelta, pixelMax);
    maxLumaDelta = Math.max(maxLumaDelta, calculateLuma(afterPixel) - calculateLuma(beforePixel));
  }

  return {
    broadCoverageRatio: roundMetric(before.length === 0 ? 0 : broadCoveragePixels / before.length),
    changedPixelRatio: roundMetric(before.length === 0 ? 0 : changedPixels / before.length),
    maxAbsDelta: roundMetric(maxAbsDelta),
    maxLumaDelta: roundMetric(maxLumaDelta),
    neutralPatchMaxDelta: roundMetric(neutralPatchMaxDelta),
    outputClipCount,
  };
}

function buildProvenance(input: FilmHalationRuntimeInputV1): FilmHalationRuntimeResultV1['provenance'] {
  return {
    algorithmId: ALGORITHM_ID,
    colorDomain: 'working_linear_rgb',
    constants: {
      grayReferenceLuma: 0.18,
      lumaCoefficients: LUMA_COEFFICIENTS,
      warmEndpointXyY: '0.46,0.40,1.0',
    },
    controls: input.controls,
    edgeMode: 'clamp_to_edge',
    kernel: 'gaussian_mask_only_reference',
    referenceWhite: 'D65',
    renderStage: 'late_working_linear_before_output_transform',
    sigmaPx: roundMetric(resolveSigmaPx(input)),
    workingSpace: input.workingSpace,
  };
}

function resolveSigmaPx(input: FilmHalationRuntimeInputV1): number {
  const baseSigma = input.controls.sigmaShortEdgeFraction * input.fullResShortEdgePx;
  const previewScale = input.previewShortEdgePx === undefined ? 1 : input.previewShortEdgePx / input.fullResShortEdgePx;
  return baseSigma * previewScale;
}

function isPreviewApproximation(input: FilmHalationRuntimeInputV1): boolean {
  return input.previewShortEdgePx !== undefined && resolveSigmaPx(input) < 0.75;
}

function resolveWarmVector(warmth: number): { b: number; g: number; r: number } {
  return {
    b: roundMetric(mix(1, WARM_ENDPOINT_UNIT_LUMA.b, warmth)),
    g: roundMetric(mix(1, WARM_ENDPOINT_UNIT_LUMA.g, warmth)),
    r: roundMetric(mix(1, WARM_ENDPOINT_UNIT_LUMA.r, warmth)),
  };
}

function countChangedPixels(
  before: ReadonlyArray<FilmHalationPixelV1>,
  after: ReadonlyArray<FilmHalationPixelV1>,
): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    if (beforePixel === undefined) return true;
    return pixel.r !== beforePixel.r || pixel.g !== beforePixel.g || pixel.b !== beforePixel.b;
  }).length;
}

function calculateLuma(pixel: Pick<FilmHalationPixelV1, 'b' | 'g' | 'r'>): number {
  return LUMA_COEFFICIENTS.r * pixel.r + LUMA_COEFFICIENTS.g * pixel.g + LUMA_COEFFICIENTS.b * pixel.b;
}

function hashPixels(pixels: ReadonlyArray<FilmHalationPixelV1>): string {
  const stablePixels = pixels.map(({ b, g, r, x, y }) => [
    x,
    y,
    Math.round(r * 65535),
    Math.round(g * 65535),
    Math.round(b * 65535),
  ]);
  return `fnv1a32:${hashString32(JSON.stringify(stablePixels)).toString(16).padStart(8, '0')}`;
}

function hashString32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(left: number, right: number, amount: number): number {
  return left * (1 - amount) + right * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundChannel(value: number): number {
  return Number(Math.min(4, Math.max(0, value)).toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
