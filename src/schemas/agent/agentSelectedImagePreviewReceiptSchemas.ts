import { z } from 'zod';

const agentSelectedImagePreviewReceiptSideSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    graphRevision: z.string().trim().min(1),
    previewRef: z.string().trim().min(1).optional(),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
    role: z.enum(['after', 'before']),
    toolName: z.string().trim().min(1).optional(),
  })
  .strict();

export const agentSelectedImagePreviewReceiptSchema = z
  .object({
    after: agentSelectedImagePreviewReceiptSideSchema,
    before: agentSelectedImagePreviewReceiptSideSchema,
    id: z.string().trim().min(1),
    kind: z.enum(['apply', 'dry_run']),
    requestId: z.string().trim().min(1),
    selectedImagePath: z.string().trim().min(1),
    state: z.enum(['current', 'stale']),
    staleReason: z
      .enum(['graph_revision_changed', 'image_changed', 'preview_artifact_changed', 'recipe_hash_changed'])
      .optional(),
    toolName: z.string().trim().min(1),
  })
  .strict();

export type AgentSelectedImagePreviewReceipt = z.infer<typeof agentSelectedImagePreviewReceiptSchema>;
