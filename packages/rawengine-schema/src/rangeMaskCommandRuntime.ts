import { z } from 'zod';

import { type MaskAlphaArtifact, maskAlphaArtifactSchema } from './maskComposeCommandRuntime.js';
import {
  type LayerMaskCommandEnvelopeV1,
  type LayerMaskDryRunResultV1,
  type LayerMaskMutationResultV1,
  layerMaskCommandEnvelopeV1Schema,
  layerMaskDryRunResultV1Schema,
  layerMaskMutationResultV1Schema,
  layerMaskRangeSelectionV1Schema,
} from './rawEngineSchemas.js';

const normalizedPixelSchema = z.number().min(0).max(1);

export const rangeMaskAlphaRenderRequestSchema = z
  .object({
    height: z.number().int().positive().max(16384),
    maskId: z.string().trim().min(1),
    selection: layerMaskRangeSelectionV1Schema,
    source: z.literal('working_rgb'),
    sourceRgbPixels: z.array(normalizedPixelSchema).min(3),
    width: z.number().int().positive().max(16384),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sourceRgbPixels.length !== request.width * request.height * 3) {
      context.addIssue({
        code: 'custom',
        message: 'Range mask source RGB pixels must contain three channels per source pixel.',
        path: ['sourceRgbPixels'],
      });
    }
  });

export const rangeMaskAlphaStatsSchema = z
  .object({
    maxAlpha: normalizedPixelSchema,
    meanAlpha: normalizedPixelSchema,
    nonzeroAlphaRatio: normalizedPixelSchema,
    warningCodes: z.array(z.enum(['empty_selection', 'tiny_selection'])),
  })
  .strict();

export const rangeMaskAlphaRenderResultSchema = z
  .object({
    artifact: maskAlphaArtifactSchema,
    colorMath: z.literal('encoded_rgb_hsv_rec709_luma_v1'),
    stats: rangeMaskAlphaStatsSchema,
  })
  .strict();

export type RangeMaskAlphaRenderRequest = z.infer<typeof rangeMaskAlphaRenderRequestSchema>;
export type RangeMaskAlphaRenderResult = z.infer<typeof rangeMaskAlphaRenderResultSchema>;
export type RangeMaskCommand = Extract<LayerMaskCommandEnvelopeV1, { commandType: 'layerMask.createRangeMask' }>;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const quantizeAlpha = (value: number): number => Math.round(clamp01(value) * 255);

const stableAlphaHash = (alpha: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const value of alpha) {
    hash ^= quantizeAlpha(value);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const buildPlanKey = (command: RangeMaskCommand, request: RangeMaskAlphaRenderRequest): string =>
  JSON.stringify([
    command.expectedGraphRevision,
    command.target,
    command.parameters,
    request.maskId,
    request.width,
    request.height,
    stableRgbHash(request.sourceRgbPixels),
  ]);

const stableRgbHash = (pixels: ReadonlyArray<number>): string => {
  let hash = 0x811c9dc5;
  for (const value of pixels) {
    hash ^= Math.round(clamp01(value) * 65535);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
};

const rec709Luma = (red: number, green: number, blue: number): number =>
  clamp01(0.2126 * red + 0.7152 * green + 0.0722 * blue);

const hueDistanceDegrees = (left: number, right: number): number => {
  const delta = Math.abs((((left - right) % 360) + 540) % 360) - 180;
  return Math.min(delta, 360 - delta);
};

const rgbToHsvSample = (red: number, green: number, blue: number) => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hueDegrees = 0;

  if (delta > 0.000001) {
    if (max === red) hueDegrees = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hueDegrees = 60 * ((blue - red) / delta + 2);
    else hueDegrees = 60 * ((red - green) / delta + 4);
  }

  return {
    hueDegrees: (hueDegrees + 360) % 360,
    luma: rec709Luma(red, green, blue),
    saturation: max <= 0.000001 ? 0 : delta / max,
  };
};

const evaluateLuminanceRange = (
  luma: number,
  selection: Extract<RangeMaskAlphaRenderRequest['selection'], { rangeKind: 'luminance' }>,
): number => {
  if (luma < selection.minLuma || luma > selection.maxLuma) return 0;
  const fade = Math.max((selection.maxLuma - selection.minLuma) * selection.feather, 0.0001);
  const lowerWeight = Math.min(1, (luma - selection.minLuma) / fade);
  const upperWeight = Math.min(1, (selection.maxLuma - luma) / fade);
  return clamp01(Math.min(lowerWeight, upperWeight));
};

const evaluateColorRange = (
  sample: ReturnType<typeof rgbToHsvSample>,
  selection: Extract<RangeMaskAlphaRenderRequest['selection'], { rangeKind: 'color' }>,
): number => {
  if (
    sample.luma < selection.minLuma ||
    sample.luma > selection.maxLuma ||
    sample.saturation < selection.minSaturation ||
    sample.saturation > selection.maxSaturation
  ) {
    return 0;
  }

  const hueDistance = hueDistanceDegrees(sample.hueDegrees, selection.centerHueDegrees);
  const innerRadius = selection.hueToleranceDegrees * (1 - selection.feather);
  if (hueDistance <= innerRadius) return 1;
  if (hueDistance >= selection.hueToleranceDegrees) return 0;
  return clamp01(1 - (hueDistance - innerRadius) / Math.max(selection.hueToleranceDegrees - innerRadius, 0.0001));
};

const buildStats = (alpha: ReadonlyArray<number>): z.infer<typeof rangeMaskAlphaStatsSchema> => {
  const maxAlpha = alpha.reduce((max, value) => Math.max(max, value), 0);
  const nonzeroCount = alpha.filter((value) => value > 0.000001).length;
  const meanAlpha = alpha.reduce((sum, value) => sum + value, 0) / alpha.length;
  const nonzeroAlphaRatio = nonzeroCount / alpha.length;
  const warningCodes: z.infer<typeof rangeMaskAlphaStatsSchema>['warningCodes'] = [];
  if (maxAlpha <= 0.000001) warningCodes.push('empty_selection');
  else if (nonzeroAlphaRatio < 0.05) warningCodes.push('tiny_selection');

  return rangeMaskAlphaStatsSchema.parse({
    maxAlpha: Number(maxAlpha.toFixed(6)),
    meanAlpha: Number(meanAlpha.toFixed(6)),
    nonzeroAlphaRatio: Number(nonzeroAlphaRatio.toFixed(6)),
    warningCodes,
  });
};

export const renderRangeMaskAlphaArtifact = (value: unknown): RangeMaskAlphaRenderResult => {
  const request = rangeMaskAlphaRenderRequestSchema.parse(value);
  const alpha: number[] = [];

  for (let index = 0; index < request.sourceRgbPixels.length; index += 3) {
    const red = request.sourceRgbPixels[index] ?? 0;
    const green = request.sourceRgbPixels[index + 1] ?? 0;
    const blue = request.sourceRgbPixels[index + 2] ?? 0;
    const sample = rgbToHsvSample(red, green, blue);
    const weight =
      request.selection.rangeKind === 'luminance'
        ? evaluateLuminanceRange(sample.luma, request.selection)
        : evaluateColorRange(sample, request.selection);
    alpha.push(Number(weight.toFixed(6)));
  }

  const artifact: MaskAlphaArtifact = maskAlphaArtifactSchema.parse({
    alpha,
    contentHash: stableAlphaHash(alpha),
    height: request.height,
    maskId: request.maskId,
    width: request.width,
  });

  return rangeMaskAlphaRenderResultSchema.parse({
    artifact,
    colorMath: 'encoded_rgb_hsv_rec709_luma_v1',
    stats: buildStats(alpha),
  });
};

export class RangeMaskCommandRuntime {
  readonly #acceptedDryRuns: Set<string> = new Set<string>();

  dispatch(
    command: LayerMaskCommandEnvelopeV1,
    request: Omit<RangeMaskAlphaRenderRequest, 'selection' | 'source'>,
  ): LayerMaskDryRunResultV1 | LayerMaskMutationResultV1 {
    const parsedCommand = layerMaskCommandEnvelopeV1Schema.parse(command);
    if (parsedCommand.commandType !== 'layerMask.createRangeMask') {
      throw new Error('Range mask runtime only supports createRangeMask commands.');
    }
    if (parsedCommand.parameters.source !== 'working_rgb') {
      throw new Error('Range mask runtime currently requires working_rgb source samples.');
    }

    const renderRequest = rangeMaskAlphaRenderRequestSchema.parse({
      ...request,
      selection: parsedCommand.parameters.selection,
      source: parsedCommand.parameters.source,
    });
    const render = renderRangeMaskAlphaArtifact(renderRequest);
    const planKey = buildPlanKey(parsedCommand, renderRequest);
    if (parsedCommand.dryRun) {
      this.#acceptedDryRuns.add(planKey);
      return buildRangeMaskDryRunResult(parsedCommand, render);
    }

    if (!this.#acceptedDryRuns.has(planKey)) {
      throw new Error('Range mask runtime rejected apply without a matching dry-run.');
    }

    return buildRangeMaskMutationResult(parsedCommand, render);
  }
}

export const buildRangeMaskDryRunResult = (
  command: RangeMaskCommand,
  render: RangeMaskAlphaRenderResult,
): LayerMaskDryRunResultV1 =>
  layerMaskDryRunResultV1Schema.parse({
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: true,
    maskArtifacts: [
      {
        artifactId: `artifact_${render.artifact.maskId}`,
        contentHash: render.artifact.contentHash,
        dimensions: {
          height: render.artifact.height,
          width: render.artifact.width,
        },
        kind: 'mask',
        storage: 'temp_cache',
      },
    ],
    mutates: false,
    parameterDiff: [
      {
        entityId: null,
        entityKind: 'mask',
        path: '/masks/-',
        value: {
          colorMath: render.colorMath,
          maskId: render.artifact.maskId,
          maskName: command.parameters.maskName,
          selection: command.parameters.selection,
          source: command.parameters.source,
          stats: render.stats,
        },
      },
    ],
    predictedGraphRevision: `${command.expectedGraphRevision}:preview:${command.commandId}`,
    previewArtifacts: [],
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    warnings: render.stats.warningCodes,
  });

export const buildRangeMaskMutationResult = (
  command: RangeMaskCommand,
  render: RangeMaskAlphaRenderResult,
): LayerMaskMutationResultV1 =>
  layerMaskMutationResultV1Schema.parse({
    appliedGraphRevision: `${command.expectedGraphRevision}:apply:${command.commandId}`,
    changedLayerIds: [],
    changedMaskIds: [render.artifact.maskId],
    changedNodeIds: [`node_${render.artifact.maskId}`],
    commandId: command.commandId,
    commandType: command.commandType,
    correlationId: command.correlationId,
    dryRun: false,
    mutates: true,
    schemaVersion: command.schemaVersion,
    sourceGraphRevision: command.expectedGraphRevision,
    undoRevision: command.expectedGraphRevision,
    warnings: render.stats.warningCodes,
  });
