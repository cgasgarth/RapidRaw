import { z } from 'zod';
import type { Adjustments } from './adjustments';

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
  coordinates: WhiteBalancePickerSampleCoordinates;
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

const srgbToLinear = (value: number): number => (value / 255.0) ** 2.2;

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
  const nextAdjustments = {
    ...currentAdjustments,
    temperature: adjustment.temperature,
    tint: adjustment.tint,
  };

  return {
    adjustment,
    nextAdjustments,
    receipt: {
      averageRgb: whiteBalancePickerSampleSchema.parse(averageRgb),
      coordinates,
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
