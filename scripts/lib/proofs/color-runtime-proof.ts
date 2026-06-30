import { createHash } from 'node:crypto';

import { z } from 'zod';

import { rawOpenEditExportBasicToneCommandSchema } from '../../../src/schemas/rawOpenEditExportCommandSchemas.ts';
import { applyWhiteBalanceToRgbPixel, type RgbPixel } from '../../../src/utils/whiteBalancePicker.ts';

const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const colorRuntimeRgbPixelSchema = z
  .object({
    blue: z.number().min(0).max(1),
    green: z.number().min(0).max(1),
    red: z.number().min(0).max(1),
  })
  .strict();

const colorRuntimeWhiteBalanceSchema = z
  .object({
    temperature: z.number().min(-100).max(100),
    tint: z.number().min(-100).max(100),
  })
  .strict();

const colorRuntimeProofExpectedSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixels: z.number().int().positive(),
    outputPixels: z.array(colorRuntimeRgbPixelSchema).min(1),
    toneChangedPixels: z.number().int().positive(),
    whiteBalanceChangedPixels: z.number().int().positive(),
    whiteBalancedHash: hashSchema,
  })
  .strict();

export const colorRuntimeProofFixtureSchema = z
  .object({
    expected: colorRuntimeProofExpectedSchema,
    proofId: z.literal('color.runtime.white-balance-tone.synthetic.v1'),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    schemaVersion: z.literal(1),
    sourcePixels: z.array(colorRuntimeRgbPixelSchema).min(1),
    toneCommand: rawOpenEditExportBasicToneCommandSchema,
    whiteBalance: colorRuntimeWhiteBalanceSchema,
  })
  .strict();

export const colorRuntimeProofArtifactSchema = z
  .object({
    afterHash: hashSchema,
    beforeHash: hashSchema,
    changedPixels: z.number().int().positive(),
    commandId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    outputPixels: z.array(colorRuntimeRgbPixelSchema).min(1),
    proofId: z.literal('color.runtime.white-balance-tone.synthetic.v1'),
    renderer: z.literal('synthetic_white_balance_basic_tone_v1'),
    runtimeStatus: z.literal('synthetic_runtime_apply_capable'),
    schemaVersion: z.literal(1),
    toneChangedPixels: z.number().int().positive(),
    whiteBalanceChangedPixels: z.number().int().positive(),
    whiteBalancedHash: hashSchema,
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.beforeHash === artifact.whiteBalancedHash) {
      context.addIssue({ code: 'custom', message: 'White balance stage must change the source hash.' });
    }

    if (artifact.whiteBalancedHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Tone stage must change the white-balanced hash.' });
    }

    if (artifact.beforeHash === artifact.afterHash) {
      context.addIssue({ code: 'custom', message: 'Final render output must change the source hash.' });
    }
  });

export type ColorRuntimeProofArtifact = z.infer<typeof colorRuntimeProofArtifactSchema>;
export type ColorRuntimeProofFixture = z.infer<typeof colorRuntimeProofFixtureSchema>;
type BasicToneParameters = z.infer<typeof rawOpenEditExportBasicToneCommandSchema>['parameters'];

const CHANNEL_KEYS = ['red', 'green', 'blue'] as const;

export function renderColorRuntimeProof(fixture: ColorRuntimeProofFixture): ColorRuntimeProofArtifact {
  const whiteBalancedPixels = fixture.sourcePixels.map((pixel) =>
    roundRgbPixel(
      applyWhiteBalanceToRgbPixel(pixel, fixture.whiteBalance.temperature, fixture.whiteBalance.tint).outputRgb,
    ),
  );
  const outputPixels = whiteBalancedPixels.map((pixel) =>
    applyBasicToneToRgbPixel(pixel, fixture.toneCommand.parameters),
  );

  return colorRuntimeProofArtifactSchema.parse({
    afterHash: hashRgbPixels(outputPixels),
    beforeHash: hashRgbPixels(fixture.sourcePixels),
    changedPixels: countChangedPixels(fixture.sourcePixels, outputPixels),
    commandId: fixture.toneCommand.commandId,
    graphRevision: fixture.toneCommand.expectedGraphRevision,
    outputPixels,
    proofId: fixture.proofId,
    renderer: 'synthetic_white_balance_basic_tone_v1',
    runtimeStatus: fixture.runtimeStatus,
    schemaVersion: fixture.schemaVersion,
    toneChangedPixels: countChangedPixels(whiteBalancedPixels, outputPixels),
    whiteBalanceChangedPixels: countChangedPixels(fixture.sourcePixels, whiteBalancedPixels),
    whiteBalancedHash: hashRgbPixels(whiteBalancedPixels),
  });
}

export function collectColorRuntimeProofFailures(
  fixture: ColorRuntimeProofFixture,
  artifact: ColorRuntimeProofArtifact,
): Array<string> {
  const failures: Array<string> = [];

  for (const key of [
    'afterHash',
    'beforeHash',
    'changedPixels',
    'toneChangedPixels',
    'whiteBalanceChangedPixels',
    'whiteBalancedHash',
  ] as const) {
    if (artifact[key] !== fixture.expected[key]) {
      failures.push(`${key}: expected ${fixture.expected[key]}, got ${artifact[key]}`);
    }
  }

  const expectedJson = JSON.stringify(fixture.expected.outputPixels);
  const actualJson = JSON.stringify(artifact.outputPixels);
  if (actualJson !== expectedJson) {
    failures.push(`outputPixels: expected ${expectedJson}, got ${actualJson}`);
  }

  return failures;
}

function applyBasicToneToRgbPixel(pixel: RgbPixel, parameters: BasicToneParameters): RgbPixel {
  const mean = (pixel.red + pixel.green + pixel.blue) / CHANNEL_KEYS.length;
  const exposureScale = 2 ** parameters.exposureEv;
  const contrastScale = 1 + parameters.contrast / 100;
  const saturationScale = 1 + parameters.saturation / 100;
  const lift = (parameters.shadows - parameters.blackPoint) / 500;
  const shoulder = (parameters.whitePoint - parameters.highlights) / 500;
  const clarity = parameters.clarity / 800;

  return {
    blue: applyBasicToneChannel(
      pixel.blue,
      mean,
      exposureScale,
      contrastScale,
      saturationScale,
      lift,
      shoulder,
      clarity,
    ),
    green: applyBasicToneChannel(
      pixel.green,
      mean,
      exposureScale,
      contrastScale,
      saturationScale,
      lift,
      shoulder,
      clarity,
    ),
    red: applyBasicToneChannel(pixel.red, mean, exposureScale, contrastScale, saturationScale, lift, shoulder, clarity),
  };
}

function applyBasicToneChannel(
  channel: number,
  mean: number,
  exposureScale: number,
  contrastScale: number,
  saturationScale: number,
  lift: number,
  shoulder: number,
  clarity: number,
): number {
  const exposed = channel * exposureScale + lift + shoulder;
  const contrasted = (exposed - 0.5) * contrastScale + 0.5;
  const saturated = mean + (contrasted - mean) * saturationScale;
  return roundChannel(clamp01(saturated + clarity * (channel - mean)));
}

function countChangedPixels(before: ReadonlyArray<RgbPixel>, after: ReadonlyArray<RgbPixel>): number {
  return after.filter((pixel, index) => {
    const beforePixel = before[index];
    if (beforePixel === undefined) return true;

    return CHANNEL_KEYS.some((channel) => pixel[channel] !== beforePixel[channel]);
  }).length;
}

function hashRgbPixels(pixels: ReadonlyArray<RgbPixel>): string {
  const stablePixels = pixels.map((pixel) => [pixel.red, pixel.green, pixel.blue]);
  return `sha256:${createHash('sha256').update(JSON.stringify(stablePixels)).digest('hex')}`;
}

function roundRgbPixel(pixel: RgbPixel): RgbPixel {
  return {
    blue: roundChannel(pixel.blue),
    green: roundChannel(pixel.green),
    red: roundChannel(pixel.red),
  };
}

function roundChannel(value: number): number {
  return Number(value.toFixed(6));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
