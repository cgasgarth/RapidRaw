import { z } from 'zod';

import type { Adjustments, HueSatLum } from './adjustments';
import type { SelectiveColorRangeControl } from './selectiveColorRanges';

export const SELECTIVE_COLOR_COMMAND_SCHEMA_VERSION = 1;

export const SELECTIVE_COLOR_COMMAND_RANGE_KEYS = [
  'reds',
  'oranges',
  'yellows',
  'greens',
  'aquas',
  'blues',
  'purples',
  'magentas',
] as const;

export const TONE_COLOR_HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;

export type SelectiveColorCommandRangeKey = (typeof SELECTIVE_COLOR_COMMAND_RANGE_KEYS)[number];
export type ToneColorHslBand = (typeof TONE_COLOR_HSL_BANDS)[number];

const selectiveColorCommandContextActorSchema = z.looseObject({
  id: z.string().trim().min(1),
  kind: z.enum(['agent', 'batch', 'cli', 'plugin', 'server', 'test', 'ui']),
  sessionId: z.string().trim().min(1).optional(),
});

const selectiveColorCommandContextTargetSchema = z
  .looseObject({
    id: z.string().trim().min(1).optional(),
    imagePath: z.string().trim().min(1).optional(),
    kind: z.enum(['image', 'virtual_copy']),
    virtualCopyId: z.string().trim().min(1).nullable().optional(),
  })
  .refine((target) => target.id !== undefined || target.imagePath !== undefined, {
    message: 'Target requires an id or imagePath.',
  });

const selectiveColorCommandColorPipelineSchema = z
  .object({
    chromaticAdaptation: z.looseObject({}),
    gamutMapping: z.looseObject({}).optional(),
    inputDomain: z.string().trim().min(1),
    operationDomain: z.string().trim().min(1),
    renderTarget: z.looseObject({}).optional(),
    sceneToDisplayTransform: z.string().trim().min(1).optional(),
    workingSpace: z.string().trim().min(1),
  })
  .strict();

export const selectiveColorCommandEnvelopeSchema = z
  .object({
    actor: selectiveColorCommandContextActorSchema,
    approval: z
      .object({
        approvalClass: z.enum(['edit_apply', 'preview_only']),
        reason: z.string().trim().min(1),
        state: z.enum(['approved', 'not_required']),
      })
      .strict(),
    colorPipeline: selectiveColorCommandColorPipelineSchema,
    commandId: z.string().trim().min(1),
    commandType: z.literal('toneColor.adjustHsl'),
    correlationId: z.string().trim().min(1),
    dryRun: z.boolean(),
    expectedGraphRevision: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1).optional(),
    parameters: z
      .object({
        band: z.enum(TONE_COLOR_HSL_BANDS),
        acceptedDryRunPlanHash: z.string().trim().min(1).optional(),
        acceptedDryRunPlanId: z.string().trim().min(1).optional(),
        hueShiftDegrees: z.number().min(-180).max(180),
        luminance: z.number().min(-100).max(100),
        rangeControl: z
          .object({
            centerHueDegrees: z.number().min(0).max(360),
            falloffSmoothness: z.number().min(0.25).max(4),
            widthDegrees: z.number().min(10).max(180),
          })
          .strict()
          .optional(),
        saturation: z.number().min(-100).max(100),
      })
      .strict(),
    schemaVersion: z.literal(SELECTIVE_COLOR_COMMAND_SCHEMA_VERSION),
    target: selectiveColorCommandContextTargetSchema,
  })
  .strict();

export type SelectiveColorCommandContextActor = z.infer<typeof selectiveColorCommandContextActorSchema>;
export type SelectiveColorCommandContextTarget = z.infer<typeof selectiveColorCommandContextTargetSchema>;
export type SelectiveColorCommandColorPipeline = z.infer<typeof selectiveColorCommandColorPipelineSchema>;
export type SelectiveColorCommandEnvelope = z.infer<typeof selectiveColorCommandEnvelopeSchema>;

export const selectiveColorAdjustmentPayloadSchema = z
  .object({
    adjustment: z
      .object({
        hue: z.number().min(-180).max(180),
        luminance: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
      })
      .strict(),
    rangeControl: z
      .object({
        centerHueDegrees: z.number().min(0).max(360),
        falloffSmoothness: z.number().min(0.25).max(4),
        widthDegrees: z.number().min(10).max(180),
      })
      .strict()
      .optional(),
    rangeKey: z.enum(SELECTIVE_COLOR_COMMAND_RANGE_KEYS),
  })
  .strict();

export type SelectiveColorAdjustmentPayload = z.infer<typeof selectiveColorAdjustmentPayloadSchema>;

export interface SelectiveColorCommandBridgeContext {
  actor: SelectiveColorCommandContextActor;
  colorPipeline: SelectiveColorCommandColorPipeline;
  commandId: string;
  correlationId: string;
  expectedGraphRevision: string;
  idempotencyKey?: string;
  target: SelectiveColorCommandContextTarget;
}

export interface SelectiveColorImageCommandContextOptions {
  expectedGraphRevision: string;
  imagePath: string;
  operationId: string;
  sessionId: string;
  colorPipeline: SelectiveColorCommandColorPipeline;
  virtualCopyId?: string;
}

export interface SelectiveColorCommandBridgeOptions {
  acceptedDryRunPlanHash?: string;
  acceptedDryRunPlanId?: string;
  dryRun: boolean;
  reason?: string;
}

const DEFAULT_PREVIEW_REASON = 'Preview selective color adjustment before mutating the edit graph.';
const DEFAULT_APPLY_REASON = 'Apply accepted selective color adjustment through the typed command bridge.';
const COMMAND_RANGE_TO_HSL_BAND = {
  aquas: 'aqua',
  blues: 'blue',
  greens: 'green',
  magentas: 'magenta',
  oranges: 'orange',
  purples: 'purple',
  reds: 'red',
  yellows: 'yellow',
} as const satisfies Record<SelectiveColorCommandRangeKey, ToneColorHslBand>;

const HSL_BAND_TO_COMMAND_RANGE = {
  aqua: 'aquas',
  blue: 'blues',
  green: 'greens',
  magenta: 'magentas',
  orange: 'oranges',
  purple: 'purples',
  red: 'reds',
  yellow: 'yellows',
} as const satisfies Record<ToneColorHslBand, SelectiveColorCommandRangeKey>;

export const buildSelectiveColorImageCommandContext = ({
  colorPipeline,
  expectedGraphRevision,
  imagePath,
  operationId,
  sessionId,
  virtualCopyId,
}: SelectiveColorImageCommandContextOptions): SelectiveColorCommandBridgeContext => ({
  actor: {
    id: 'rapidraw-ui',
    kind: 'ui',
    sessionId,
  },
  colorPipeline,
  commandId: `selective_color_${operationId}`,
  correlationId: `selective_color_corr_${operationId}`,
  expectedGraphRevision,
  idempotencyKey: `selective_color_idem_${operationId}`,
  target: {
    imagePath,
    kind: 'image',
    ...(virtualCopyId !== undefined ? { virtualCopyId } : {}),
  },
});

export const hasSelectiveColorAdjustmentChange = (previous: HueSatLum, next: HueSatLum): boolean =>
  previous.hue !== next.hue || previous.saturation !== next.saturation || previous.luminance !== next.luminance;

export const buildSelectiveColorCommandEnvelope = (
  payload: SelectiveColorAdjustmentPayload,
  context: SelectiveColorCommandBridgeContext,
  options: SelectiveColorCommandBridgeOptions,
): SelectiveColorCommandEnvelope => {
  const parsedPayload = selectiveColorAdjustmentPayloadSchema.parse(payload);
  const envelope: SelectiveColorCommandEnvelope = {
    actor: context.actor,
    approval: {
      approvalClass: options.dryRun ? 'preview_only' : 'edit_apply',
      reason: options.reason ?? (options.dryRun ? DEFAULT_PREVIEW_REASON : DEFAULT_APPLY_REASON),
      state: options.dryRun ? 'not_required' : 'approved',
    },
    colorPipeline: context.colorPipeline,
    commandId: context.commandId,
    commandType: 'toneColor.adjustHsl',
    correlationId: context.correlationId,
    dryRun: options.dryRun,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      band: COMMAND_RANGE_TO_HSL_BAND[parsedPayload.rangeKey],
      ...(options.dryRun
        ? {}
        : {
            acceptedDryRunPlanHash: options.acceptedDryRunPlanHash,
            acceptedDryRunPlanId: options.acceptedDryRunPlanId,
          }),
      hueShiftDegrees: parsedPayload.adjustment.hue,
      luminance: parsedPayload.adjustment.luminance,
      ...(parsedPayload.rangeControl !== undefined ? { rangeControl: parsedPayload.rangeControl } : {}),
      saturation: parsedPayload.adjustment.saturation,
    },
    schemaVersion: SELECTIVE_COLOR_COMMAND_SCHEMA_VERSION,
    target: context.target,
  };

  if (!options.dryRun) {
    if (options.acceptedDryRunPlanHash === undefined || options.acceptedDryRunPlanId === undefined) {
      throw new Error('Selective color apply commands require accepted dry-run plan identity.');
    }
  }

  if (context.idempotencyKey !== undefined) {
    envelope.idempotencyKey = context.idempotencyKey;
  }

  return parseSelectiveColorCommandEnvelope(envelope);
};

export const parseSelectiveColorCommandEnvelope = (command: unknown): SelectiveColorCommandEnvelope => {
  return selectiveColorCommandEnvelopeSchema.parse(command);
};

export const applySelectiveColorCommandEnvelopeToAdjustments = (base: Adjustments, command: unknown): Adjustments => {
  const parsedCommand = parseSelectiveColorCommandEnvelope(command);
  const rangeKey = HSL_BAND_TO_COMMAND_RANGE[parsedCommand.parameters.band];
  const rangeControl: SelectiveColorRangeControl | undefined = parsedCommand.parameters.rangeControl;

  return {
    ...base,
    hsl: {
      ...base.hsl,
      [rangeKey]: {
        hue: parsedCommand.parameters.hueShiftDegrees,
        luminance: parsedCommand.parameters.luminance,
        saturation: parsedCommand.parameters.saturation,
      },
    },
    ...(rangeControl !== undefined
      ? {
          selectiveColorRangeControls: {
            ...base.selectiveColorRangeControls,
            [rangeKey]: rangeControl,
          },
        }
      : {}),
  };
};
