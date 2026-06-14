import { z } from 'zod';

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

const clampSlider = (value: number): number => Math.max(sliderMinimum, Math.min(sliderMaximum, value));

const srgbToLinear = (value: number): number => Math.pow(value / 255.0, 2.2);

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
