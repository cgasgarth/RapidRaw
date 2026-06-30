import type { AgentEditRecipeKind } from './agentEditRecipePlanner';

export interface AgentEditIntentClassification {
  brightenIntent: boolean;
  contrastIntent: boolean;
  correctiveWarmCastIntent: boolean;
  landscapeIntent: boolean;
  portraitIntent: boolean;
  recipeKind: AgentEditRecipeKind;
  warmToneIntent: boolean;
}

const includesAny = (value: string, needles: readonly string[]): boolean =>
  needles.some((needle) => value.includes(needle));

const hasCorrectiveWarmCastIntent = (normalized: string): boolean =>
  includesAny(normalized, [
    'less warm',
    'reduce the warm',
    'reduce warm',
    'remove the warm',
    'remove warm',
    'neutralize the warm',
    'neutralize warm',
    'correct the warm',
    'correct warm',
    'too warm',
    'warm cast',
    'orange cast',
    'yellow cast',
  ]) ||
  /\b(reduce|remove|neutralize|correct|less|dial back|cool down)\b.{0,32}\b(warm|orange|yellow)\b/.test(normalized);

export const classifyAgentEditIntent = (prompt: string): AgentEditIntentClassification => {
  const normalized = prompt.toLowerCase();
  const correctiveWarmCastIntent = hasCorrectiveWarmCastIntent(normalized);
  const portraitIntent = includesAny(normalized, ['portrait', 'skin', 'face', 'headshot']);
  const landscapeIntent = includesAny(normalized, [
    'alaska',
    'blue',
    'foreground',
    'landscape',
    'mountain',
    'mountains',
    'scenic',
    'sky',
    'travel',
    'vista',
  ]);
  const brightenIntent = includesAny(normalized, ['bright', 'exposure', 'dark', 'flat', 'highlight', 'highlights']);
  const contrastIntent = includesAny(normalized, ['contrast', 'pop', 'flat', 'detail', 'deepen']);
  const positiveWarmIntent =
    includesAny(normalized, ['warm', 'warmer', 'golden', 'orange']) && !correctiveWarmCastIntent;
  const warmToneIntent = portraitIntent || positiveWarmIntent;
  const recipeKind: AgentEditRecipeKind =
    landscapeIntent && !portraitIntent
      ? 'cool_landscape_detail'
      : warmToneIntent
        ? 'warm_portrait_pop'
        : 'brighten_flat_raw';

  return {
    brightenIntent,
    contrastIntent,
    correctiveWarmCastIntent,
    landscapeIntent,
    portraitIntent,
    recipeKind,
    warmToneIntent,
  };
};
