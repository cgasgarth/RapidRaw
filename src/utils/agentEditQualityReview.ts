import { z } from 'zod';

import type { AgentPreviewEnvelope } from './agentPreviewEnvelope';

export const agentEditReviewRubricAreaSchema = z.enum([
  'color_white_balance',
  'crop_detail',
  'exposure_tone',
  'local_intent',
  'retouch_artifacts',
  'user_confirmation',
]);

export const agentEditReviewRubricEntrySchema = z
  .object({
    area: agentEditReviewRubricAreaSchema,
    note: z.string().trim().min(1),
    status: z.enum(['attention', 'not_applicable', 'pass']),
  })
  .strict();

export const agentEditQualityReviewSchema = z
  .object({
    finalRationale: z.string().trim().min(1),
    preview: z
      .object({
        id: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    reviewId: z.string().trim().min(1),
    rubric: z.array(agentEditReviewRubricEntrySchema).length(6),
    stopReason: z.enum(['continue_iterating', 'finish', 'request_detail_preview', 'request_user_approval']),
    toolReceiptCount: z.number().int().nonnegative(),
  })
  .strict();

export type AgentEditQualityReview = z.infer<typeof agentEditQualityReviewSchema>;

export const buildAgentEditQualityReview = (input: {
  maxIterationsReached: boolean;
  preview: AgentPreviewEnvelope;
  prompt: string;
  toolReceiptCount: number;
}): AgentEditQualityReview => {
  const prompt = input.prompt.toLowerCase();
  const asksForDetail = /\b(detail|sharp|retouch|heal|clone|mask|local|crop)\b/u.test(prompt);
  const hasDetailPreview = input.preview.purpose === 'detail_review';
  const needsApproval = /\b(export|write|overwrite|remove|delete)\b/u.test(prompt);
  const stopReason = input.maxIterationsReached
    ? 'continue_iterating'
    : needsApproval
      ? 'request_user_approval'
      : asksForDetail && !hasDetailPreview
        ? 'request_detail_preview'
        : 'finish';

  return agentEditQualityReviewSchema.parse({
    finalRationale:
      stopReason === 'finish'
        ? 'Current preview and tool receipts satisfy the prompt; stop without another edit.'
        : stopReason === 'request_detail_preview'
          ? 'Prompt asks for local/detail judgment; request a bounded crop preview before finalizing.'
          : stopReason === 'request_user_approval'
            ? 'Prompt includes a gated action; wait for user approval before continuing.'
            : 'Iteration budget was reached; stop and ask for review before more edits.',
    preview: {
      id: input.preview.id,
      recipeHash: input.preview.recipeHash,
      renderHash: input.preview.renderHash,
    },
    reviewId: `agent-edit-review:${input.preview.id}`,
    rubric: [
      {
        area: 'exposure_tone',
        note:
          input.toolReceiptCount > 0 ? 'Tone receipts exist for the current preview.' : 'No tone receipt exists yet.',
        status: input.toolReceiptCount > 0 ? 'pass' : 'attention',
      },
      {
        area: 'color_white_balance',
        note: 'No color cast warning was raised by this bounded review.',
        status: 'pass',
      },
      {
        area: 'local_intent',
        note: asksForDetail ? 'Prompt includes local/detail language.' : 'No local edit intent detected.',
        status: asksForDetail && !hasDetailPreview ? 'attention' : 'not_applicable',
      },
      {
        area: 'retouch_artifacts',
        note: prompt.includes('retouch')
          ? 'Retouch language needs detail preview inspection.'
          : 'No retouch request detected.',
        status: prompt.includes('retouch') && !hasDetailPreview ? 'attention' : 'not_applicable',
      },
      {
        area: 'crop_detail',
        note: hasDetailPreview ? 'A crop/detail preview is attached.' : 'Only full-frame preview is attached.',
        status: asksForDetail && !hasDetailPreview ? 'attention' : 'pass',
      },
      {
        area: 'user_confirmation',
        note: needsApproval ? 'A gated action requires approval.' : 'No gated write/destructive action detected.',
        status: needsApproval ? 'attention' : 'pass',
      },
    ],
    stopReason,
    toolReceiptCount: input.toolReceiptCount,
  });
};
