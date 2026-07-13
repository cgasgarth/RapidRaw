import { z } from 'zod';
import type { Adjustments } from './adjustments';
import { buildTechnicalWhiteBalance, cctToXy, technicalWhiteBalanceSchema } from './color/whiteBalance';

const sliderMinimum = -100;
const sliderMaximum = 100;

export const whiteBalancePickerSampleSchema = z
  .object({
    red: z.number().min(0).max(255),
    green: z.number().min(0).max(255),
    blue: z.number().min(0).max(255),
  })
  .strict();

export const whiteBalancePickerInputSchema = z
  .object({
    currentTemperature: z.number().min(sliderMinimum).max(sliderMaximum),
    currentTint: z.number().min(sliderMinimum).max(sliderMaximum),
    sample: whiteBalancePickerSampleSchema,
  })
  .strict();

export type WhiteBalancePickerInput = z.infer<typeof whiteBalancePickerInputSchema>;

export interface WhiteBalancePickerResult {
  deltaTemperature: number;
  deltaTint: number;
  temperature: number;
  tint: number;
}

export interface WhiteBalancePickerSampleCoordinates {
  imageX: number;
  imageY: number;
  previewPixelX: number;
  previewPixelY: number;
}

export interface WhiteBalancePickerRuntimeReceipt {
  averageRgb: z.infer<typeof whiteBalancePickerSampleSchema>;
  algorithm: 'neutral_patch_scene_linear_chromaticity_v1';
  clippedChannelCount: number;
  confidence: number;
  coordinates: WhiteBalancePickerSampleCoordinates;
  estimatedDuv: number;
  estimatedKelvin: number;
  estimatedXy: [number, number];
  patchPixelCount: number;
  previewIdentity: string;
  resultingTemperature: number;
  resultingTint: number;
  selectedImagePath: string;
}

export interface WhiteBalancePickerAdjustmentCommand {
  adjustment: WhiteBalancePickerResult;
  nextAdjustments: Adjustments;
  receipt: WhiteBalancePickerRuntimeReceipt;
}

export interface WhiteBalancePickerAdjustmentCommandInput {
  averageRgb: z.infer<typeof whiteBalancePickerSampleSchema>;
  coordinates: WhiteBalancePickerSampleCoordinates;
  currentAdjustments: Adjustments;
  previewIdentity: string;
  selectedImagePath: string;
}

export interface RgbPixel {
  blue: number;
  green: number;
  red: number;
}

export interface WhiteBalanceRgbResult {
  outputRgb: RgbPixel;
  temperatureMultiplier: RgbPixel;
  tintMultiplier: RgbPixel;
}

const clampSlider = (value: number): number => Math.max(sliderMinimum, Math.min(sliderMaximum, value));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const srgbToLinear = (value: number): number => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const xyToUv = ([x, y]: readonly number[]): [number, number] => {
  const denominator = -2 * (x ?? 0) + 12 * (y ?? 0) + 3;
  return [(4 * (x ?? 0)) / denominator, (6 * (y ?? 0)) / denominator];
};

export const estimateNeutralSampleIlluminant = (sample: z.infer<typeof whiteBalancePickerSampleSchema>) => {
  const parsed = whiteBalancePickerSampleSchema.parse(sample);
  const red = srgbToLinear(parsed.red);
  const green = srgbToLinear(parsed.green);
  const blue = srgbToLinear(parsed.blue);
  const xyz: [number, number, number] = [
    0.4124564 * red + 0.3575761 * green + 0.1804375 * blue,
    0.2126729 * red + 0.7151522 * green + 0.072175 * blue,
    0.0193339 * red + 0.119192 * green + 0.9503041 * blue,
  ];
  const sum = xyz[0] + xyz[1] + xyz[2];
  const xy: [number, number] = sum > 1e-9 ? [xyz[0] / sum, xyz[1] / sum] : [0.32168, 0.33767];
  const uv = xyToUv(xy);
  let nearestKelvin = 6504;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestUv: [number, number] = xyToUv(cctToXy(nearestKelvin));
  for (let kelvin = 1667; kelvin <= 25000; kelvin += kelvin < 5000 ? 10 : 25) {
    const candidateUv = xyToUv(cctToXy(kelvin));
    const distance = Math.hypot(uv[0] - candidateUv[0], uv[1] - candidateUv[1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKelvin = kelvin;
      nearestUv = candidateUv;
    }
  }
  const chroma = Math.max(parsed.red, parsed.green, parsed.blue) - Math.min(parsed.red, parsed.green, parsed.blue);
  const clippedChannelCount = [parsed.red, parsed.green, parsed.blue].filter(
    (value) => value <= 1 || value >= 254,
  ).length;
  return {
    xy,
    kelvin: nearestKelvin,
    duv: Math.min(0.05, Math.max(-0.05, Math.sign(uv[1] - nearestUv[1]) * nearestDistance)),
    clippedChannelCount,
    confidence: Math.max(0, Math.min(1, (1 - clippedChannelCount / 3) * (1 - chroma / 255))),
  };
};

export const calculateWhiteBalancePickerAdjustment = (input: WhiteBalancePickerInput): WhiteBalancePickerResult => {
  const parsed = whiteBalancePickerInputSchema.parse(input);
  const linR = srgbToLinear(parsed.sample.red);
  const linG = srgbToLinear(parsed.sample.green);
  const linB = srgbToLinear(parsed.sample.blue);

  const sumRB = linR + linB;
  const deltaTemperature = sumRB > 0.0001 ? ((linB - linR) / sumRB) * 125.0 : 0;

  const linM = sumRB / 2.0;
  const sumGM = linG + linM;
  const deltaTint = sumGM > 0.0001 ? ((linG - linM) / sumGM) * 400.0 : 0;

  return {
    deltaTemperature,
    deltaTint,
    temperature: clampSlider(parsed.currentTemperature + deltaTemperature),
    tint: clampSlider(parsed.currentTint + deltaTint),
  };
};

export const averageWhiteBalancePickerRgbaSample = (
  data: Uint8ClampedArray | ArrayLike<number>,
): z.infer<typeof whiteBalancePickerSampleSchema> | null => {
  if (data.length < 4) return null;

  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    redTotal += data[i] ?? 0;
    greenTotal += data[i + 1] ?? 0;
    blueTotal += data[i + 2] ?? 0;
    count += 1;
  }

  if (count === 0) return null;

  return whiteBalancePickerSampleSchema.parse({
    red: redTotal / count,
    green: greenTotal / count,
    blue: blueTotal / count,
  });
};

export const buildWhiteBalancePickerAdjustmentCommand = ({
  averageRgb,
  coordinates,
  currentAdjustments,
  previewIdentity,
  selectedImagePath,
}: WhiteBalancePickerAdjustmentCommandInput): WhiteBalancePickerAdjustmentCommand => {
  const adjustment = calculateWhiteBalancePickerAdjustment({
    currentTemperature: currentAdjustments.temperature,
    currentTint: currentAdjustments.tint,
    sample: averageRgb,
  });
  const estimate = estimateNeutralSampleIlluminant(averageRgb);
  const technical = buildTechnicalWhiteBalance('chromaticity', estimate.kelvin, estimate.duv, 'picker');
  const nextAdjustments = {
    ...currentAdjustments,
    // Retain legacy mirrors for command/audit compatibility; render authority
    // is the typed technical illuminant below.
    temperature: adjustment.temperature,
    tint: adjustment.tint,
    whiteBalanceTechnical: technicalWhiteBalanceSchema.parse({
      ...technical,
      x: estimate.xy[0],
      y: estimate.xy[1],
      confidence: estimate.confidence,
      sampleCount: 1,
    }),
    whiteBalanceMigration: 'native_v1' as const,
  };

  return {
    adjustment,
    nextAdjustments,
    receipt: {
      averageRgb: whiteBalancePickerSampleSchema.parse(averageRgb),
      algorithm: 'neutral_patch_scene_linear_chromaticity_v1',
      clippedChannelCount: estimate.clippedChannelCount,
      confidence: estimate.confidence,
      coordinates,
      estimatedDuv: estimate.duv,
      estimatedKelvin: estimate.kelvin,
      estimatedXy: estimate.xy,
      patchPixelCount: 1,
      previewIdentity,
      resultingTemperature: adjustment.temperature,
      resultingTint: adjustment.tint,
      selectedImagePath,
    },
  };
};

export const applyWhiteBalanceToRgbPixel = (
  pixel: RgbPixel,
  temperature: number,
  tint: number,
): WhiteBalanceRgbResult => {
  const normalizedTemperature = clampSlider(temperature) / 100;
  const normalizedTint = clampSlider(tint) / 100;
  const temperatureMultiplier = {
    blue: 1 - normalizedTemperature * 0.2,
    green: 1 + normalizedTemperature * 0.05,
    red: 1 + normalizedTemperature * 0.2,
  };
  const tintMultiplier = {
    blue: 1 + normalizedTint * 0.25,
    green: 1 - normalizedTint * 0.25,
    red: 1 + normalizedTint * 0.25,
  };

  return {
    outputRgb: {
      blue: clamp01(pixel.blue * temperatureMultiplier.blue * tintMultiplier.blue),
      green: clamp01(pixel.green * temperatureMultiplier.green * tintMultiplier.green),
      red: clamp01(pixel.red * temperatureMultiplier.red * tintMultiplier.red),
    },
    temperatureMultiplier,
    tintMultiplier,
  };
};
