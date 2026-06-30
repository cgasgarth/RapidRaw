import { z } from 'zod';

import { type FilmGrainModelV1, filmGrainModelV1Schema } from './rawEngineSchemas.js';

const FILM_GRAIN_RUNTIME_SCHEMA_VERSION = 1;

const filmGrainRuntimePixelV1Schema = z
  .object({
    b: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    r: z.number().min(0).max(1),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
  })
  .strict();

export const filmGrainRuntimeInputV1Schema = z
  .object({
    imageId: z.string().trim().min(1),
    pixels: z.array(filmGrainRuntimePixelV1Schema).min(1),
    sourceContentHash: z.string().trim().min(1),
    variantKey: z.string().trim().min(1).optional(),
  })
  .strict();

export const filmGrainRuntimeResultV1Schema = z
  .object({
    afterHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    beforeHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/u),
    changedPixels: z.number().int().nonnegative(),
    metrics: z
      .object({
        averageAbsDelta: z.number().min(0),
        changedPixelRatio: z.number().min(0).max(1),
        maxAbsDelta: z.number().min(0),
      })
      .strict(),
    modelId: z.string().trim().min(1),
    outputPixels: z.array(filmGrainRuntimePixelV1Schema).min(1),
    provenance: z
      .object({
        algorithm: z.literal('procedural_luma_chroma_noise_v1'),
        claimBoundary: z.literal('synthetic_cpu_reference_not_measured_stock_emulation'),
        renderStage: z.literal('creative_final_after_glow'),
        seed: z.number().int().nonnegative(),
        seedPolicy: z.enum(['stable_per_image', 'stable_per_variant', 'explicit_seed', 'random_per_render']),
      })
      .strict(),
    runtimeStatus: z.literal('cpu_reference_runtime_apply_capable'),
    schemaVersion: z.literal(FILM_GRAIN_RUNTIME_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.beforeHash === result.afterHash && result.changedPixels > 0) {
      context.addIssue({ code: 'custom', message: 'Changed grain output requires a changed output hash.' });
    }
  });

export type FilmGrainRuntimeInputV1 = z.infer<typeof filmGrainRuntimeInputV1Schema>;
export type FilmGrainRuntimePixelV1 = z.infer<typeof filmGrainRuntimePixelV1Schema>;
export type FilmGrainRuntimeResultV1 = z.infer<typeof filmGrainRuntimeResultV1Schema>;

export function applyFilmGrainRuntime(
  inputValue: FilmGrainRuntimeInputV1,
  modelValue: FilmGrainModelV1,
): FilmGrainRuntimeResultV1 {
  const input = filmGrainRuntimeInputV1Schema.parse(inputValue);
  const model = filmGrainModelV1Schema.parse(modelValue);

  if (model.algorithm !== 'procedural_luma_chroma_noise_v1') {
    throw new Error(`Unsupported film grain runtime algorithm: ${model.algorithm}`);
  }

  const seed = resolveFilmGrainSeed(input, model);
  const amount = (model.intensity.amount / 100) * 0.07;
  const roughness = model.intensity.roughness / 100;
  const cellSize = Math.max(1, Math.round(1 + (model.intensity.size / 100) * 12));
  const outputPixels = input.pixels.map((pixel) => {
    const luma = calculateLuma(pixel);
    const toneScale = calculateToneScale(luma, model);
    const highlightProtection = model.toneResponse.protectClippedHighlights ? 1 - smoothstep(0.94, 1, luma) : 1;
    const scaledAmount = amount * toneScale * highlightProtection;
    const fineNoise = signedNoise(seed, pixel.x, pixel.y, 1, 0);
    const coarseNoise = signedNoise(seed, Math.floor(pixel.x / cellSize), Math.floor(pixel.y / cellSize), cellSize, 1);
    const baseNoise = mix(fineNoise, coarseNoise, roughness);
    const lumaNoise = baseNoise * scaledAmount * model.channelSeparation.lumaAmount;
    const chromaAmount = scaledAmount * model.channelSeparation.chromaAmount;
    const chromaCorrelation = model.channelSeparation.chromaCorrelation;
    const chromaR = mix(baseNoise, signedNoise(seed, pixel.x, pixel.y, cellSize, 2), 1 - chromaCorrelation);
    const chromaG = mix(baseNoise, signedNoise(seed, pixel.x, pixel.y, cellSize, 3), 1 - chromaCorrelation);
    const chromaB = mix(baseNoise, signedNoise(seed, pixel.x, pixel.y, cellSize, 4), 1 - chromaCorrelation);
    const chromaMean = (chromaR + chromaG + chromaB) / 3;

    return {
      b: roundChannel(pixel.b + lumaNoise + (chromaB - chromaMean) * chromaAmount),
      g: roundChannel(pixel.g + lumaNoise + (chromaG - chromaMean) * chromaAmount),
      r: roundChannel(pixel.r + lumaNoise + (chromaR - chromaMean) * chromaAmount),
      x: pixel.x,
      y: pixel.y,
    };
  });

  return filmGrainRuntimeResultV1Schema.parse({
    afterHash: hashPixels(outputPixels),
    beforeHash: hashPixels(input.pixels),
    changedPixels: countChangedPixels(input.pixels, outputPixels),
    metrics: calculateMetrics(input.pixels, outputPixels),
    modelId: model.modelId,
    outputPixels,
    provenance: {
      algorithm: model.algorithm,
      claimBoundary: 'synthetic_cpu_reference_not_measured_stock_emulation',
      renderStage: model.renderStage,
      seed,
      seedPolicy: model.seedPolicy.mode,
    },
    runtimeStatus: 'cpu_reference_runtime_apply_capable',
    schemaVersion: FILM_GRAIN_RUNTIME_SCHEMA_VERSION,
  });
}

function resolveFilmGrainSeed(input: FilmGrainRuntimeInputV1, model: FilmGrainModelV1): number {
  if (model.seedPolicy.mode === 'explicit_seed') {
    return model.seedPolicy.seed ?? 0;
  }

  const variant = model.seedPolicy.mode === 'stable_per_variant' ? (input.variantKey ?? 'default_variant') : 'image';
  return hashString32([input.imageId, input.sourceContentHash, model.modelId, model.modelVersion, variant].join(':'));
}

function calculateToneScale(luma: number, model: FilmGrainModelV1): number {
  const shadowWeight =
    luma <= model.toneResponse.shadow.endLuma
      ? 1 - smoothstep(model.toneResponse.shadow.startLuma, model.toneResponse.shadow.endLuma, luma)
      : 0;
  const highlightWeight =
    luma >= model.toneResponse.highlight.startLuma
      ? smoothstep(model.toneResponse.highlight.startLuma, model.toneResponse.highlight.endLuma, luma)
      : 0;
  const midtoneWeight = Math.max(0, 1 - Math.max(shadowWeight, highlightWeight));

  return (
    shadowWeight * model.toneResponse.shadow.amountScale +
    midtoneWeight * model.toneResponse.midtoneAmountScale +
    highlightWeight * model.toneResponse.highlight.amountScale
  );
}

function calculateMetrics(
  before: ReadonlyArray<FilmGrainRuntimePixelV1>,
  after: ReadonlyArray<FilmGrainRuntimePixelV1>,
): FilmGrainRuntimeResultV1['metrics'] {
  let totalDelta = 0;
  let maxAbsDelta = 0;
  let channelCount = 0;
  let changedPixels = 0;

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
    maxAbsDelta = Math.max(maxAbsDelta, pixelMax);
    totalDelta += deltas.reduce((sum, delta) => sum + delta, 0);
    channelCount += deltas.length;
  }

  return {
    averageAbsDelta: roundMetric(channelCount === 0 ? 0 : totalDelta / channelCount),
    changedPixelRatio: roundMetric(before.length === 0 ? 0 : changedPixels / before.length),
    maxAbsDelta: roundMetric(maxAbsDelta),
  };
}

function countChangedPixels(
  before: ReadonlyArray<FilmGrainRuntimePixelV1>,
  after: ReadonlyArray<FilmGrainRuntimePixelV1>,
): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    if (beforePixel === undefined) return true;
    return pixel.r !== beforePixel.r || pixel.g !== beforePixel.g || pixel.b !== beforePixel.b;
  }).length;
}

function calculateLuma(pixel: FilmGrainRuntimePixelV1): number {
  return 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;
}

function signedNoise(seed: number, x: number, y: number, cellSize: number, channel: number): number {
  const hash = hashString32([seed, x, y, cellSize, channel].join(':'));
  return (hash / 0xffffffff) * 2 - 1;
}

function hashPixels(pixels: ReadonlyArray<FilmGrainRuntimePixelV1>): string {
  const stablePixels = pixels.map(({ b, g, r, x, y }) => [
    x,
    y,
    Math.round(clamp01(r) * 65535),
    Math.round(clamp01(g) * 65535),
    Math.round(clamp01(b) * 65535),
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
  return Number(clamp01(value).toFixed(6));
}

function roundMetric(value: number): number {
  return Number(value.toFixed(6));
}
