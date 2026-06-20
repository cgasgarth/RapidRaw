import { z } from 'zod';

import type { Adjustments, HueSatLum } from './adjustments';

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
export type SelectiveColorCommandContextActor = Record<string, unknown>;
export type SelectiveColorCommandContextTarget = Record<string, unknown> & { kind: 'image' | 'virtual_copy' };

export const selectiveColorAdjustmentPayloadSchema = z
  .object({
    adjustment: z
      .object({
        hue: z.number().min(-180).max(180),
        luminance: z.number().min(-100).max(100),
        saturation: z.number().min(-100).max(100),
      })
      .strict(),
    rangeKey: z.enum(SELECTIVE_COLOR_COMMAND_RANGE_KEYS),
  })
  .strict();

export type SelectiveColorAdjustmentPayload = z.infer<typeof selectiveColorAdjustmentPayloadSchema>;

export interface SelectiveColorCommandEnvelope {
  actor: SelectiveColorCommandContextActor;
  approval: {
    approvalClass: 'edit_apply' | 'preview_only';
    reason: string;
    state: 'approved' | 'not_required';
  };
  colorPipeline: Record<string, unknown>;
  commandId: string;
  commandType: 'toneColor.adjustHsl';
  correlationId: string;
  dryRun: boolean;
  expectedGraphRevision: string;
  idempotencyKey?: string;
  parameters: {
    band: ToneColorHslBand;
    hueShiftDegrees: number;
    luminance: number;
    saturation: number;
  };
  schemaVersion: typeof SELECTIVE_COLOR_COMMAND_SCHEMA_VERSION;
  target: SelectiveColorCommandContextTarget;
}

export interface SelectiveColorCommandBridgeContext {
  actor: SelectiveColorCommandContextActor;
  colorPipeline: Record<string, unknown>;
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
}

export interface SelectiveColorCommandBridgeOptions {
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
  expectedGraphRevision,
  imagePath,
  operationId,
  sessionId,
}: SelectiveColorImageCommandContextOptions): SelectiveColorCommandBridgeContext => ({
  actor: {
    id: 'rapidraw-ui',
    kind: 'ui',
    sessionId,
  },
  colorPipeline: {
    chromaticAdaptation: {
      method: 'bradford_v1',
      sourceWhitePoint: { x: 0.3457, y: 0.3585 },
      status: 'math_validated',
      targetWhitePoint: { x: 0.32168, y: 0.33767 },
      warnings: [],
    },
    inputDomain: 'camera_linear_rgb',
    operationDomain: 'acescg_linear_v1',
    renderTarget: {
      bitDepth: 8,
      embedIcc: true,
      intent: 'relative_colorimetric',
      outputProfile: 'display_p3',
      viewTransform: 'rawengine_agx_v1',
    },
    sceneToDisplayTransform: 'rawengine_agx_v1',
    workingSpace: 'acescg_linear_v1',
  },
  commandId: `selective_color_${operationId}`,
  correlationId: `selective_color_corr_${operationId}`,
  expectedGraphRevision,
  idempotencyKey: `selective_color_idem_${operationId}`,
  target: {
    imagePath,
    kind: 'image',
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
      hueShiftDegrees: parsedPayload.adjustment.hue,
      luminance: parsedPayload.adjustment.luminance,
      saturation: parsedPayload.adjustment.saturation,
    },
    schemaVersion: SELECTIVE_COLOR_COMMAND_SCHEMA_VERSION,
    target: context.target,
  };

  if (context.idempotencyKey !== undefined) {
    envelope.idempotencyKey = context.idempotencyKey;
  }

  return envelope;
};

export const applySelectiveColorCommandEnvelopeToAdjustments = (
  base: Adjustments,
  command: SelectiveColorCommandEnvelope,
): Adjustments => {
  const rangeKey = HSL_BAND_TO_COMMAND_RANGE[command.parameters.band];

  return {
    ...base,
    hsl: {
      ...base.hsl,
      [rangeKey]: {
        hue: command.parameters.hueShiftDegrees,
        luminance: command.parameters.luminance,
        saturation: command.parameters.saturation,
      },
    },
  };
};
