import { z } from 'zod';
import { useEditorStore } from '../../../store/useEditorStore';
import { runAgentCoreEditCommandBundle } from './agentCoreEditCommandBundle';
import { agentEditRecipeKindSchema, planAgentEditRecipe } from './agentEditRecipePlanner';

const selectableColorRangeSchema = z.enum([
  'reds',
  'oranges',
  'yellows',
  'greens',
  'cyans',
  'blues',
  'purples',
  'magentas',
]);

export const agentPromptCommandFixtureSchema = z
  .object({
    expectedHslRange: selectableColorRangeSchema,
    expectedRecipeKind: agentEditRecipeKindSchema,
    id: z.string().trim().min(1),
    minimumChangedPixelCount: z.number().int().min(1),
    prompt: z.string().trim().min(1),
  })
  .strict();

export const agentPromptCommandEvaluationSchema = z
  .object({
    appliedGraphRevision: z.string().trim().min(1),
    changedPixelCount: z.number().int().min(1),
    fixtureId: z.string().trim().min(1),
    outputHash: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    recipeKind: agentEditRecipeKindSchema,
    selectedHslRange: selectableColorRangeSchema,
  })
  .strict();

export type AgentPromptCommandFixture = z.infer<typeof agentPromptCommandFixtureSchema>;
export type AgentPromptCommandEvaluation = z.infer<typeof agentPromptCommandEvaluationSchema>;

export const agentPromptCommandFixtures = [
  {
    expectedHslRange: 'oranges',
    expectedRecipeKind: 'warm_portrait_pop',
    id: 'warm-portrait-pop',
    minimumChangedPixelCount: 4,
    prompt: 'Make this portrait warmer with better skin tones and a polished contrast pop.',
  },
  {
    expectedHslRange: 'blues',
    expectedRecipeKind: 'cool_landscape_detail',
    id: 'cool-alaska-landscape',
    minimumChangedPixelCount: 4,
    prompt: 'Cool the Alaska landscape sky and add more crisp mountain detail.',
  },
  {
    expectedHslRange: 'yellows',
    expectedRecipeKind: 'brighten_flat_raw',
    id: 'brighten-flat-raw',
    minimumChangedPixelCount: 4,
    prompt: 'The RAW file is dark and flat. Brighten exposure, recover shadows, and keep color natural.',
  },
] as const satisfies readonly AgentPromptCommandFixture[];

const getSelectedHslRange = (fixture: AgentPromptCommandFixture): AgentPromptCommandEvaluation['selectedHslRange'] => {
  const plan = planAgentEditRecipe(fixture.prompt);
  const range = plan.steps.find((step) => step.kind === 'selective_color')?.payload.rangeKey;
  return selectableColorRangeSchema.parse(range);
};

export const evaluateAgentPromptCommandFixture = async (
  fixture: AgentPromptCommandFixture,
): Promise<AgentPromptCommandEvaluation> => {
  agentPromptCommandFixtureSchema.parse(fixture);

  const plan = planAgentEditRecipe(fixture.prompt);
  if (plan.recipeKind !== fixture.expectedRecipeKind) {
    throw new Error(
      `Prompt fixture ${fixture.id} selected ${plan.recipeKind}, expected ${fixture.expectedRecipeKind}.`,
    );
  }

  const selectedHslRange = getSelectedHslRange(fixture);
  if (selectedHslRange !== fixture.expectedHslRange) {
    throw new Error(`Prompt fixture ${fixture.id} selected ${selectedHslRange}, expected ${fixture.expectedHslRange}.`);
  }

  const result = await runAgentCoreEditCommandBundle({
    operationId: `prompt_eval_${fixture.id}`,
    sessionId: `agent-prompt-command-evaluation-${fixture.id}`,
    steps: plan.steps,
  });

  if (result.changedPixelCount < fixture.minimumChangedPixelCount) {
    throw new Error(
      `Prompt fixture ${fixture.id} changed ${result.changedPixelCount} pixels, expected at least ${fixture.minimumChangedPixelCount}.`,
    );
  }

  const state = useEditorStore.getState();
  if (state.finalPreviewUrl?.startsWith('rawengine-preview://')) {
    throw new Error(
      `Prompt fixture ${fixture.id} published a synthetic preview URL instead of a native render handoff.`,
    );
  }

  return agentPromptCommandEvaluationSchema.parse({
    appliedGraphRevision: result.appliedGraphRevision,
    changedPixelCount: result.changedPixelCount,
    fixtureId: fixture.id,
    outputHash: result.outputHash,
    prompt: fixture.prompt,
    recipeKind: plan.recipeKind,
    selectedHslRange,
  });
};
