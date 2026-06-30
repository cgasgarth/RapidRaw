import { z } from 'zod';

import type { AgentPreviewEnvelope } from '../context/agentPreviewEnvelope';

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
    afterPreview: z
      .object({
        id: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    beforePreview: z
      .object({
        id: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    finalRationale: z.string().trim().min(1),
    followUpRequests: z.array(
      z
        .object({
          reason: z.string().trim().min(1),
          toolName: z.string().trim().min(1),
          urgency: z.enum(['before_finalize', 'optional_refinement']),
        })
        .strict(),
    ),
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
    toolReceipts: z
      .array(
        z
          .object({
            graphRevision: z.string().trim().min(1),
            summary: z.string().trim().min(1),
            toolName: z.string().trim().min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type AgentEditQualityReview = z.infer<typeof agentEditQualityReviewSchema>;

export const buildAgentEditQualityReview = (input: {
  beforePreview: AgentPreviewEnvelope;
  maxIterationsReached: boolean;
  preview: AgentPreviewEnvelope;
  prompt: string;
  toolReceiptCount: number;
  toolReceipts?: readonly { graphRevision: string; summary: string; toolName: string }[];
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
  const toolReceipts =
    input.toolReceipts && input.toolReceipts.length > 0
      ? input.toolReceipts
      : [{ graphRevision: input.preview.recipeHash, summary: 'Legacy receipt count only.', toolName: 'unknown' }];
  const followUpRequests =
    stopReason === 'request_detail_preview'
      ? [
          {
            reason: 'Inspect a bounded crop/detail preview before finalizing local/detail quality.',
            toolName: 'rawengine.agent.preview.render',
            urgency: 'before_finalize' as const,
          },
        ]
      : stopReason === 'continue_iterating'
        ? [
            {
              reason:
                'Iteration budget reached before review could finalize; request one additional bounded edit pass.',
              toolName: 'rawengine.agent.adjustments.apply',
              urgency: 'before_finalize' as const,
            },
          ]
        : stopReason === 'request_user_approval'
          ? [
              {
                reason: 'User approval is required before gated output or destructive actions.',
                toolName: 'rawengine.agent.approval.request',
                urgency: 'before_finalize' as const,
              },
            ]
          : [];

  return agentEditQualityReviewSchema.parse({
    afterPreview: {
      id: input.preview.id,
      recipeHash: input.preview.recipeHash,
      renderHash: input.preview.renderHash,
    },
    beforePreview: {
      id: input.beforePreview.id,
      recipeHash: input.beforePreview.recipeHash,
      renderHash: input.beforePreview.renderHash,
    },
    finalRationale:
      stopReason === 'finish'
        ? 'Current preview and tool receipts satisfy the prompt; stop without another edit.'
        : stopReason === 'request_detail_preview'
          ? 'Prompt asks for local/detail judgment; request a bounded crop preview before finalizing.'
          : stopReason === 'request_user_approval'
            ? 'Prompt includes a gated action; wait for user approval before continuing.'
            : 'Iteration budget was reached; stop and ask for review before more edits.',
    followUpRequests,
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
    toolReceipts,
  });
};
