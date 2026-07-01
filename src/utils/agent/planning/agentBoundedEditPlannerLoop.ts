import { z } from 'zod';
import type { AgentArtifactReview, AgentChatDryRunReview } from '../../../schemas/agent/agentChatTranscriptSchemas';
import type { AgentImageContextSnapshot } from '../context/agentImageContextSnapshot';
import { type AgentInitialPromptContext, buildAgentInitialPromptContext } from '../context/agentInitialPromptContext';
import { buildAgentToneColorDryRunExpertEdit } from '../context/agentToneColorDryRunExpertEdit';
import type { AgentCoreEditCommandBundleStep } from './agentCoreEditCommandBundle';
import { planAgentEditRecipe } from './agentEditRecipePlanner';

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
  dryRunReview: AgentChatDryRunReview;
  finalGraphRevision: string;
  artifactReview: AgentArtifactReview;
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
    dryRunReviewTargetCount: z.number().int().positive(),
    finalGraphRevision: z.string().trim().min(1),
    artifactReviewCount: z.number().int().positive(),
    initialGraphRevision: z.string().trim().min(1),
    initialPreviewArtifactId: z.string().trim().min(1),
    initialPreviewRecipeHash: z.string().trim().min(1),
    plannedStepCount: z.number().int().positive(),
    stopState: z.enum(['approval_ready', 'blocked', 'max_steps_reached']),
    transcriptLength: z.number().int().positive().max(6),
  })
  .strict();

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

  const plannedSteps = planAgentEditRecipe(prompt).steps;
  transcript.push({ detail: `planned ${plannedSteps.length} command steps`, stage: 'plan' });

  const preview = await buildAgentToneColorDryRunExpertEdit({
    expectedGraphRevision: inspected.graphRevision,
    expectedRecipeHash: inspected.initialPreview.recipeHash,
    operationId: `${operationId}_preview`,
    prompt,
    sessionId,
  });
  transcript.push({ detail: `dry-run preview ${preview.afterArtifact.artifactId}`, stage: 'dry_run' });

  const finalGraphRevision = preview.graphRevisionAfter;
  transcript.push({ detail: `observed non-mutating ${finalGraphRevision}`, stage: 'observe' });

  const result: AgentPlannerLoopResult = {
    dryRunAfterHash: preview.afterPreviewHash,
    dryRunBeforeHash: preview.beforePreviewHash,
    dryRunReview: preview.dryRunReview,
    finalGraphRevision,
    artifactReview: preview.artifactReview,
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
    dryRunReviewTargetCount: result.dryRunReview.affectedTargets.length,
    finalGraphRevision: result.finalGraphRevision,
    artifactReviewCount: result.artifactReview.previewArtifacts.length,
    initialGraphRevision: result.initialGraphRevision,
    initialPreviewArtifactId: result.initialPromptContext.preview.artifactId,
    initialPreviewRecipeHash: result.initialPromptContext.preview.recipeHash,
    plannedStepCount: result.plannedSteps.length,
    stopState: result.stopState,
    transcriptLength: result.transcript.length,
  });

  return result;
};
