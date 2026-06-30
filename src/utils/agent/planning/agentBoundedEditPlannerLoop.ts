import { z } from 'zod';
import { useEditorStore } from '../../../store/useEditorStore';
import { buildAgentBasicToneDryRunPreviewArtifacts } from '../context/agentDryRunPreviewArtifacts';
import type { AgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { type AgentInitialPromptContext, buildAgentInitialPromptContext } from '../context/agentInitialPromptContext';
import type { AgentCoreEditCommandBundleStep } from './agentCoreEditCommandBundle';
import { classifyAgentEditIntent } from './agentEditIntentClassifier';

export type AgentPlannerLoopStopState = 'approval_ready' | 'blocked' | 'max_steps_reached';
export type AgentPlannerLoopStage = 'inspect' | 'plan' | 'dry_run' | 'apply' | 'observe';

export interface AgentPlannerLoopOptions {
  maxSteps: number;
  operationId: string;
  prompt: string;
  sessionId: string;
}

export interface AgentPlannerLoopResult {
  dryRunAfterHash: string;
  dryRunBeforeHash: string;
  finalGraphRevision: string;
  initialGraphRevision: string;
  initialPromptContext: AgentInitialPromptContext;
  inspected: AgentImageContextSnapshot;
  plannedSteps: readonly AgentCoreEditCommandBundleStep[];
  stopState: AgentPlannerLoopStopState;
  transcript: Array<{ detail: string; stage: AgentPlannerLoopStage }>;
}

const agentPlannerLoopResultProofSchema = z
  .object({
    dryRunAfterHash: z.string().trim().min(1),
    dryRunBeforeHash: z.string().trim().min(1),
    finalGraphRevision: z.string().trim().min(1),
    initialGraphRevision: z.string().trim().min(1),
    initialPreviewArtifactId: z.string().trim().min(1),
    initialPreviewRecipeHash: z.string().trim().min(1),
    plannedStepCount: z.number().int().positive(),
    stopState: z.enum(['approval_ready', 'blocked', 'max_steps_reached']),
    transcriptLength: z.number().int().positive().max(6),
  })
  .strict();

const classifyPrompt = (prompt: string): readonly AgentCoreEditCommandBundleStep[] => {
  const intent = classifyAgentEditIntent(prompt);
  const landscape = intent.recipeKind === 'cool_landscape_detail';

  return [
    {
      kind: 'basic_tone',
      payload: {
        ...useEditorStore.getState().adjustments,
        blacks: landscape ? -8 : intent.contrastIntent ? -6 : -3,
        brightness: useEditorStore.getState().adjustments.brightness,
        clarity: landscape ? 18 : intent.contrastIntent ? 12 : 6,
        contrast: intent.contrastIntent ? 20 : 10,
        exposure: intent.brightenIntent ? 0.32 : 0.12,
        highlights: intent.brightenIntent ? -14 : -8,
        saturation: intent.warmToneIntent ? 8 : 4,
        shadows: intent.brightenIntent ? 10 : 5,
        whites: intent.contrastIntent ? 5 : 2,
      },
    },
    {
      kind: 'selective_color',
      payload: {
        adjustment: landscape
          ? { hue: -2, luminance: 4, saturation: 10 }
          : {
              hue: intent.warmToneIntent ? -4 : 0,
              luminance: intent.warmToneIntent ? 5 : 2,
              saturation: intent.warmToneIntent ? 12 : 4,
            },
        rangeKey: landscape ? 'blues' : intent.warmToneIntent ? 'oranges' : 'blues',
      },
    },
  ];
};

export const runAgentBoundedEditPlannerLoop = async ({
  maxSteps,
  operationId,
  prompt,
  sessionId,
}: AgentPlannerLoopOptions): Promise<AgentPlannerLoopResult> => {
  if (maxSteps < 5) throw new Error('Agent planner loop needs at least five bounded steps.');

  const transcript: AgentPlannerLoopResult['transcript'] = [];
  const initialPromptContext = buildAgentInitialPromptContext({ operationId, prompt, sessionId });
  const inspected = initialPromptContext.imageContext;
  transcript.push({
    detail: `sent initial prompt context ${initialPromptContext.preview.artifactId}`,
    stage: 'inspect',
  });

  const plannedSteps = classifyPrompt(prompt);
  transcript.push({ detail: `planned ${plannedSteps.length} command steps`, stage: 'plan' });

  const basicToneStep = plannedSteps.find((step) => step.kind === 'basic_tone');
  if (basicToneStep?.kind !== 'basic_tone') {
    transcript.push({ detail: 'no previewable basic-tone step', stage: 'observe' });
    return {
      dryRunAfterHash: '',
      dryRunBeforeHash: '',
      finalGraphRevision: inspected.graphRevision,
      initialGraphRevision: inspected.graphRevision,
      initialPromptContext,
      inspected,
      plannedSteps,
      stopState: 'blocked',
      transcript,
    };
  }

  const preview = await buildAgentBasicToneDryRunPreviewArtifacts({
    operationId: `${operationId}_preview`,
    requestedAdjustments: basicToneStep.payload,
    sessionId,
  });
  transcript.push({ detail: `dry-run preview ${preview.afterArtifact.artifactId}`, stage: 'dry_run' });

  const finalGraphRevision = `history_${useEditorStore.getState().historyIndex}`;
  transcript.push({ detail: `observed non-mutating ${finalGraphRevision}`, stage: 'observe' });

  const result: AgentPlannerLoopResult = {
    dryRunAfterHash: preview.afterPreviewHash,
    dryRunBeforeHash: preview.beforePreviewHash,
    finalGraphRevision,
    initialGraphRevision: inspected.graphRevision,
    initialPromptContext,
    inspected,
    plannedSteps,
    stopState: 'approval_ready',
    transcript,
  };

  agentPlannerLoopResultProofSchema.parse({
    dryRunAfterHash: result.dryRunAfterHash,
    dryRunBeforeHash: result.dryRunBeforeHash,
    finalGraphRevision: result.finalGraphRevision,
    initialGraphRevision: result.initialGraphRevision,
    initialPreviewArtifactId: result.initialPromptContext.preview.artifactId,
    initialPreviewRecipeHash: result.initialPromptContext.preview.recipeHash,
    plannedStepCount: result.plannedSteps.length,
    stopState: result.stopState,
    transcriptLength: result.transcript.length,
  });

  return result;
};
