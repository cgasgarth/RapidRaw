import { z } from 'zod';

import { useEditorStore } from '../store/useEditorStore';

import type { AgentCoreEditCommandBundleStep } from './agentCoreEditCommandBundle';

export const agentEditRecipeKindSchema = z.enum(['brighten_flat_raw', 'warm_portrait_pop', 'cool_landscape_detail']);

export const agentEditRecipePlanSchema = z
  .object({
    recipeKind: agentEditRecipeKindSchema,
    recipeName: z.string().trim().min(1),
    steps: z.array(z.object({ kind: z.enum(['basic_tone', 'selective_color']) }).loose()).min(1),
    summary: z.string().trim().min(1),
  })
  .strict();

export type AgentEditRecipeKind = z.infer<typeof agentEditRecipeKindSchema>;
export type AgentEditRecipePlan = Omit<z.infer<typeof agentEditRecipePlanSchema>, 'steps'> & {
  steps: AgentCoreEditCommandBundleStep[];
};

const includesAny = (value: string, needles: readonly string[]): boolean =>
  needles.some((needle) => value.includes(needle));

export const planAgentEditRecipe = (prompt: string): AgentEditRecipePlan => {
  const normalized = prompt.toLowerCase();
  const base = useEditorStore.getState().adjustments;
  const warm = includesAny(normalized, ['warm', 'skin', 'portrait', 'golden']);
  const landscape = includesAny(normalized, ['landscape', 'mountain', 'sky', 'blue']);
  const brighten = includesAny(normalized, ['bright', 'exposure', 'dark', 'flat']);

  const recipeKind: AgentEditRecipeKind = warm
    ? 'warm_portrait_pop'
    : landscape
      ? 'cool_landscape_detail'
      : 'brighten_flat_raw';

  const plan: AgentEditRecipePlan = {
    recipeKind,
    recipeName:
      recipeKind === 'warm_portrait_pop'
        ? 'Warm portrait pop'
        : recipeKind === 'cool_landscape_detail'
          ? 'Cool landscape detail'
          : 'Brighten flat RAW',
    steps: [
      {
        kind: 'basic_tone',
        payload: {
          ...base,
          blacks: recipeKind === 'cool_landscape_detail' ? -8 : -5,
          brightness: base.brightness,
          clarity: recipeKind === 'cool_landscape_detail' ? 18 : 10,
          contrast: recipeKind === 'brighten_flat_raw' ? 16 : 20,
          exposure: brighten ? 0.35 : 0.18,
          highlights: -14,
          saturation: warm ? 8 : 5,
          shadows: brighten ? 12 : 7,
          whites: 5,
        },
      },
      {
        kind: 'selective_color',
        payload: {
          adjustment:
            recipeKind === 'cool_landscape_detail'
              ? { hue: -2, luminance: 4, saturation: 10 }
              : { hue: warm ? -4 : 0, luminance: warm ? 5 : 2, saturation: warm ? 12 : 4 },
          rangeKey: recipeKind === 'cool_landscape_detail' ? 'blues' : warm ? 'oranges' : 'yellows',
        },
      },
    ],
    summary: `Planned ${recipeKind} with tone and selective color edits.`,
  };

  agentEditRecipePlanSchema.parse(plan);
  return plan;
};
