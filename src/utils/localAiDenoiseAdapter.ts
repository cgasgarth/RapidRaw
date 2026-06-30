import {
  type AiDenoiseImageBuffer,
  type AiDenoisePixel,
  type AiDenoiseRuntimeApplyProof,
  type AiDenoiseRuntimeSettings,
  aiDenoiseImageBufferSchema,
  aiDenoiseRuntimeApplyProofSchema,
  aiDenoiseRuntimeSettingsSchema,
} from '../schemas/ai/aiDenoiseRuntimeSchemas';

export const DEFAULT_LOCAL_AI_DENOISE_SETTINGS: AiDenoiseRuntimeSettings = aiDenoiseRuntimeSettingsSchema.parse({
  chromaStrength: 0.58,
  lumaStrength: 0.46,
  modelId: 'rawengine-local-denoise-adapter-v1',
  modelVersion: '2026-06-17',
  providerClass: 'local_model',
  tileRadius: 1,
});

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const luma = (pixel: AiDenoisePixel): number => 0.2126 * pixel.r + 0.7152 * pixel.g + 0.0722 * pixel.b;

const chromaMagnitude = (pixel: AiDenoisePixel): number => {
  const y = luma(pixel);
  return Math.abs(pixel.r - y) + Math.abs(pixel.g - y) + Math.abs(pixel.b - y);
};

const hashString = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const hashPixels = (pixels: ReadonlyArray<AiDenoisePixel>): string =>
  hashString(pixels.map((pixel) => `${pixel.r.toFixed(5)},${pixel.g.toFixed(5)},${pixel.b.toFixed(5)}`).join('|'));

const withHash = (buffer: Omit<AiDenoiseImageBuffer, 'contentHash'>): AiDenoiseImageBuffer =>
  aiDenoiseImageBufferSchema.parse({
    ...buffer,
    contentHash: hashPixels(buffer.pixels),
  });

export const buildSyntheticAiDenoiseInput = (): AiDenoiseImageBuffer => {
  const width = 8;
  const height = 8;
  const pixels: AiDenoisePixel[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = x < width / 2 ? 0.28 : 0.68;
      const lumaNoise = (((x * 17 + y * 29) % 7) - 3) * 0.014;
      const chromaNoise = (((x * 11 + y * 13) % 5) - 2) * 0.018;
      pixels.push({
        b: clamp01(base + lumaNoise - chromaNoise),
        g: clamp01(base + lumaNoise * 0.65),
        r: clamp01(base + lumaNoise + chromaNoise),
      });
    }
  }

  return withHash({
    colorSpace: 'scene_linear_rgb',
    height,
    pixels,
    width,
  });
};

const pixelByIndex = (pixels: ReadonlyArray<AiDenoisePixel>, index: number): AiDenoisePixel => {
  const pixel = pixels[index];
  if (pixel === undefined) throw new Error(`Missing denoise pixel at index ${index}.`);
  return pixel;
};

const pixelAt = (buffer: AiDenoiseImageBuffer, x: number, y: number): AiDenoisePixel =>
  pixelByIndex(buffer.pixels, y * buffer.width + x);

const denoisePixel = ({
  buffer,
  settings,
  x,
  y,
}: {
  buffer: AiDenoiseImageBuffer;
  settings: AiDenoiseRuntimeSettings;
  x: number;
  y: number;
}): AiDenoisePixel => {
  const center = pixelAt(buffer, x, y);
  const centerLuma = luma(center);
  let totalWeight = 0;
  let r = 0;
  let g = 0;
  let b = 0;

  for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(buffer.height - 1, y + 1); sampleY += 1) {
    for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(buffer.width - 1, x + 1); sampleX += 1) {
      const sample = pixelAt(buffer, sampleX, sampleY);
      const edgeDelta = Math.abs(luma(sample) - centerLuma);
      const weight = 1 / (1 + edgeDelta * 80);
      totalWeight += weight;
      r += sample.r * weight;
      g += sample.g * weight;
      b += sample.b * weight;
    }
  }

  const average = {
    b: b / totalWeight,
    g: g / totalWeight,
    r: r / totalWeight,
  };
  const averageLuma = luma(average);
  const blendedLuma = centerLuma * (1 - settings.lumaStrength) + averageLuma * settings.lumaStrength;

  return {
    b: clamp01(blendedLuma + (center.b - centerLuma) * (1 - settings.chromaStrength)),
    g: clamp01(blendedLuma + (center.g - centerLuma) * (1 - settings.chromaStrength)),
    r: clamp01(blendedLuma + (center.r - centerLuma) * (1 - settings.chromaStrength)),
  };
};

const variance = (values: ReadonlyArray<number>): number => {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
};

const edgeEnergy = (buffer: AiDenoiseImageBuffer): number => {
  let energy = 0;
  for (let y = 0; y < buffer.height; y += 1) {
    for (let x = 1; x < buffer.width; x += 1) {
      energy += Math.abs(luma(pixelAt(buffer, x, y)) - luma(pixelAt(buffer, x - 1, y)));
    }
  }

  return energy;
};

const buildMetrics = ({
  input,
  output,
}: {
  input: AiDenoiseImageBuffer;
  output: AiDenoiseImageBuffer;
}): AiDenoiseRuntimeApplyProof['metrics'] => {
  let changedPixelCount = 0;
  let maxDelta = 0;
  let deltaSum = 0;

  for (let index = 0; index < input.pixels.length; index += 1) {
    const before = pixelByIndex(input.pixels, index);
    const after = pixelByIndex(output.pixels, index);
    const delta = Math.max(Math.abs(before.r - after.r), Math.abs(before.g - after.g), Math.abs(before.b - after.b));
    if (delta > 0.00001) changedPixelCount += 1;
    maxDelta = Math.max(maxDelta, delta);
    deltaSum += delta;
  }

  return {
    changedPixelCount,
    chromaVarianceAfter: variance(output.pixels.map(chromaMagnitude)),
    chromaVarianceBefore: variance(input.pixels.map(chromaMagnitude)),
    edgeEnergyRatio: edgeEnergy(output) / edgeEnergy(input),
    inputOutputMaxDelta: maxDelta,
    lumaVarianceAfter: variance(output.pixels.map(luma)),
    lumaVarianceBefore: variance(input.pixels.map(luma)),
    meanAbsoluteDelta: deltaSum / input.pixels.length,
  };
};

export const applyLocalAiDenoiseAdapter = ({
  input,
  settings = DEFAULT_LOCAL_AI_DENOISE_SETTINGS,
}: {
  input: AiDenoiseImageBuffer;
  settings?: AiDenoiseRuntimeSettings;
}): AiDenoiseRuntimeApplyProof => {
  const parsedInput = aiDenoiseImageBufferSchema.parse(input);
  const parsedSettings = aiDenoiseRuntimeSettingsSchema.parse(settings);
  const outputPixels: AiDenoisePixel[] = [];

  for (let y = 0; y < parsedInput.height; y += 1) {
    for (let x = 0; x < parsedInput.width; x += 1) {
      outputPixels.push(denoisePixel({ buffer: parsedInput, settings: parsedSettings, x, y }));
    }
  }

  const output = withHash({
    colorSpace: parsedInput.colorSpace,
    height: parsedInput.height,
    pixels: outputPixels,
    width: parsedInput.width,
  });

  return aiDenoiseRuntimeApplyProofSchema.parse({
    applyStatus: 'applied',
    doesNotProve: ['app_server_route', 'gpu_parity', 'preview_export_parity', 'real_raw_quality'],
    input: parsedInput,
    metrics: buildMetrics({ input: parsedInput, output }),
    mutates: true,
    orderedAfter: 'demosaic',
    orderedBefore: 'scene_linear_deblur',
    output,
    provenance: {
      deterministic: true,
      inputContentHash: parsedInput.contentHash,
      outputContentHash: output.contentHash,
      providerClass: parsedSettings.providerClass,
      sourceIssue: 1866,
    },
    runtimeStatus: 'runtime_apply_capable',
    schemaVersion: 1,
    settings: parsedSettings,
    stage: 'scene_linear_denoise',
    warnings: ['Synthetic local adapter proof does not prove real RAW quality, GPU parity, or preview/export parity.'],
  });
};
