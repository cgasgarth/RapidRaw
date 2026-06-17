import type { Adjustments } from './adjustments';

export const BASIC_TONE_COMMAND_SCHEMA_VERSION = 1;

export const BasicToneApprovalClass = {
  EditApply: 'edit_apply',
  PreviewOnly: 'preview_only',
} as const;

export type BasicToneApprovalClass = (typeof BasicToneApprovalClass)[keyof typeof BasicToneApprovalClass];
export type BasicToneCommandContextActor = Record<string, unknown>;
export type BasicToneCommandContextTarget = Record<string, unknown> & { kind: 'image' | 'virtual_copy' };

export interface BasicToneCommandEnvelope {
  actor: BasicToneCommandContextActor;
  approval: {
    approvalClass: BasicToneApprovalClass;
    reason: string;
    state: 'approved' | 'not_required';
  };
  colorPipeline: Record<string, unknown>;
  commandId: string;
  commandType: 'toneColor.setBasicTone';
  correlationId: string;
  dryRun: boolean;
  expectedGraphRevision: string;
  idempotencyKey?: string;
  parameters: {
    blackPoint: number;
    clarity: number;
    contrast: number;
    exposureEv: number;
    highlights: number;
    saturation: number;
    shadows: number;
    whitePoint: number;
  };
  schemaVersion: typeof BASIC_TONE_COMMAND_SCHEMA_VERSION;
  target: BasicToneCommandContextTarget;
}

export const BASIC_TONE_ADJUSTMENT_KEYS = [
  'blacks',
  'brightness',
  'clarity',
  'contrast',
  'exposure',
  'highlights',
  'saturation',
  'shadows',
  'whites',
] as const satisfies ReadonlyArray<keyof Adjustments>;

export interface BasicToneCommandBridgeContext {
  actor: BasicToneCommandContextActor;
  colorPipeline: Record<string, unknown>;
  commandId: string;
  correlationId: string;
  expectedGraphRevision: string;
  idempotencyKey?: string;
  target: BasicToneCommandContextTarget;
}

export interface BasicToneImageCommandContextOptions {
  expectedGraphRevision: string;
  imagePath: string;
  operationId: string;
  sessionId: string;
}

export interface BasicToneCommandBridgeOptions {
  dryRun: boolean;
  reason?: string;
}

const DEFAULT_PREVIEW_REASON = 'Preview basic tone adjustment before mutating the edit graph.';
const DEFAULT_APPLY_REASON = 'Apply accepted basic tone adjustment through the typed command bridge.';

export const buildBasicToneImageCommandContext = ({
  expectedGraphRevision,
  imagePath,
  operationId,
  sessionId,
}: BasicToneImageCommandContextOptions): BasicToneCommandBridgeContext => ({
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
  commandId: `basic_tone_${operationId}`,
  correlationId: `basic_tone_corr_${operationId}`,
  expectedGraphRevision,
  idempotencyKey: `basic_tone_idem_${operationId}`,
  target: {
    imagePath,
    kind: 'image',
  },
});

export const hasBasicToneAdjustmentChange = (previous: Adjustments, next: Adjustments): boolean =>
  BASIC_TONE_ADJUSTMENT_KEYS.some((key) => previous[key] !== next[key]);

export const buildBasicToneCommandEnvelope = (
  adjustments: Pick<
    Adjustments,
    'blacks' | 'brightness' | 'clarity' | 'contrast' | 'exposure' | 'highlights' | 'saturation' | 'shadows' | 'whites'
  >,
  context: BasicToneCommandBridgeContext,
  options: BasicToneCommandBridgeOptions,
): BasicToneCommandEnvelope => {
  const envelope: BasicToneCommandEnvelope = {
    actor: context.actor,
    approval: {
      approvalClass: options.dryRun ? BasicToneApprovalClass.PreviewOnly : BasicToneApprovalClass.EditApply,
      reason: options.reason ?? (options.dryRun ? DEFAULT_PREVIEW_REASON : DEFAULT_APPLY_REASON),
      state: options.dryRun ? 'not_required' : 'approved',
    },
    colorPipeline: context.colorPipeline,
    commandId: context.commandId,
    commandType: 'toneColor.setBasicTone',
    correlationId: context.correlationId,
    dryRun: options.dryRun,
    expectedGraphRevision: context.expectedGraphRevision,
    parameters: {
      blackPoint: adjustments.blacks,
      clarity: adjustments.clarity,
      contrast: adjustments.contrast,
      exposureEv: adjustments.exposure,
      highlights: adjustments.highlights,
      saturation: adjustments.saturation,
      shadows: adjustments.shadows,
      whitePoint: adjustments.whites,
    },
    schemaVersion: BASIC_TONE_COMMAND_SCHEMA_VERSION,
    target: context.target,
  };

  if (context.idempotencyKey !== undefined) {
    envelope.idempotencyKey = context.idempotencyKey;
  }

  return envelope;
};
