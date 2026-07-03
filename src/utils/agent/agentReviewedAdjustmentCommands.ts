import {
  type AgentReviewedAdjustmentCommandId,
  type AgentReviewedAdjustmentCommandReceipt,
  agentReviewedAdjustmentCommandIdSchema,
  agentReviewedAdjustmentCommandReceiptSchema,
} from '../../schemas/agent/agentReviewedCommandSchemas';
import type { Adjustments } from '../adjustments';
import type { AgentAdjustmentsApplyRequest } from './tools/agentAdjustmentApplyTool';

type AgentAdjustmentPatch = AgentAdjustmentsApplyRequest['adjustments'];
type ReviewedAdjustmentKey =
  | 'blacks'
  | 'brightness'
  | 'clarity'
  | 'contrast'
  | 'exposure'
  | 'highlights'
  | 'shadows'
  | 'whites';

interface AgentReviewedAdjustmentCommandDefinition {
  description: string;
  id: AgentReviewedAdjustmentCommandId;
  intensity: AgentReviewedAdjustmentCommandReceipt['intensity'];
  label: string;
  offsets: Partial<Record<ReviewedAdjustmentKey, number>>;
}

export interface AgentReviewedAdjustmentCommandOption {
  description: string;
  id: AgentReviewedAdjustmentCommandId;
  intensity: AgentReviewedAdjustmentCommandReceipt['intensity'];
  label: string;
}

export interface AgentReviewedAdjustmentCommandPlan {
  adjustments: AgentAdjustmentPatch;
  receipt: AgentReviewedAdjustmentCommandReceipt;
}

const AGENT_REVIEWED_ADJUSTMENT_COMMAND_DEFINITIONS = [
  {
    description: 'Recovers bright detail by lowering highlights and whites.',
    id: 'highlight_recovery',
    intensity: 'medium',
    label: 'Highlight recovery',
    offsets: { highlights: -18, whites: -6 },
  },
  {
    description: 'Opens dark regions without changing exposure.',
    id: 'shadow_lift',
    intensity: 'medium',
    label: 'Shadow lift',
    offsets: { blacks: 4, shadows: 18 },
  },
  {
    description: 'Adds controlled contrast and local presence.',
    id: 'natural_contrast',
    intensity: 'medium',
    label: 'Natural contrast',
    offsets: { clarity: 6, contrast: 10, highlights: -4, shadows: 4 },
  },
  {
    description: 'Raises exposure gently while protecting bright values.',
    id: 'gentle_exposure_lift',
    intensity: 'low',
    label: 'Gentle exposure lift',
    offsets: { brightness: 6, exposure: 0.25, highlights: -4 },
  },
] as const satisfies readonly AgentReviewedAdjustmentCommandDefinition[];

export const AGENT_REVIEWED_ADJUSTMENT_COMMAND_OPTIONS: AgentReviewedAdjustmentCommandOption[] =
  AGENT_REVIEWED_ADJUSTMENT_COMMAND_DEFINITIONS.map(({ description, id, intensity, label }) => ({
    description,
    id,
    intensity,
    label,
  }));

export const DEFAULT_AGENT_REVIEWED_ADJUSTMENT_COMMAND_ID: AgentReviewedAdjustmentCommandId = 'highlight_recovery';

const ADJUSTMENT_LIMITS = {
  blacks: { maximum: 100, minimum: -100 },
  brightness: { maximum: 100, minimum: -100 },
  clarity: { maximum: 100, minimum: -100 },
  contrast: { maximum: 100, minimum: -100 },
  exposure: { maximum: 2, minimum: -2 },
  highlights: { maximum: 100, minimum: -100 },
  shadows: { maximum: 100, minimum: -100 },
  whites: { maximum: 100, minimum: -100 },
} as const satisfies Record<ReviewedAdjustmentKey, { maximum: number; minimum: number }>;

const clampAdjustment = (key: ReviewedAdjustmentKey, value: number): number => {
  const limits = ADJUSTMENT_LIMITS[key];
  return Math.min(limits.maximum, Math.max(limits.minimum, value));
};

const getCommandDefinition = (
  commandId: AgentReviewedAdjustmentCommandId,
): AgentReviewedAdjustmentCommandDefinition => {
  const parsedCommandId = agentReviewedAdjustmentCommandIdSchema.parse(commandId);
  const definition = AGENT_REVIEWED_ADJUSTMENT_COMMAND_DEFINITIONS.find(({ id }) => id === parsedCommandId);
  if (definition === undefined) throw new Error(`Unknown reviewed agent command ${parsedCommandId}.`);
  return definition;
};

export const buildAgentReviewedAdjustmentCommandPlan = ({
  commandId,
  sourceAdjustments,
}: {
  commandId: AgentReviewedAdjustmentCommandId;
  sourceAdjustments: Pick<
    Adjustments,
    'blacks' | 'brightness' | 'clarity' | 'contrast' | 'exposure' | 'highlights' | 'shadows' | 'whites'
  >;
}): AgentReviewedAdjustmentCommandPlan => {
  const definition = getCommandDefinition(commandId);
  const entries = Object.entries(definition.offsets) as Array<[ReviewedAdjustmentKey, number]>;
  const adjustments: AgentAdjustmentPatch = {};
  for (const [key, offset] of entries) {
    adjustments[key] = clampAdjustment(key, sourceAdjustments[key] + offset);
  }
  const adjustmentDiffs = entries.map(([key, offset]) => {
    const before = sourceAdjustments[key];
    const after = clampAdjustment(key, before + offset);
    return { after, before, delta: after - before, key };
  });
  const sourceAdjustmentSnapshot = Object.fromEntries(entries.map(([key]) => [key, sourceAdjustments[key]]));

  return {
    adjustments,
    receipt: agentReviewedAdjustmentCommandReceiptSchema.parse({
      adjustmentDiffs,
      commandId: definition.id,
      intensity: definition.intensity,
      label: definition.label,
      sourceAdjustmentSnapshot,
    }),
  };
};
