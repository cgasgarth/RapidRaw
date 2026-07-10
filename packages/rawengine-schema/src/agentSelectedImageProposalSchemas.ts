import { z } from 'zod';

export const RAW_ENGINE_AGENT_SELECTED_IMAGE_PROPOSAL_RENDER_TOOL_NAME =
  'rawengine.agent.selected_image.proposal.render';

export const RawEngineAgentSelectedImageProposalCommandType = {
  Render: 'rawengine.agent.selected_image.proposal.render',
} as const;

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const basicTonePatchSchema = z
  .object({
    blacks: z.number().min(-100).max(100).optional(),
    brightness: z.number().min(-100).max(100).optional(),
    clarity: z.number().min(-100).max(100).optional(),
    contrast: z.number().min(-100).max(100).optional(),
    exposure: z.number().min(-10).max(10).optional(),
    highlights: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    shadows: z.number().min(-100).max(100).optional(),
    whites: z.number().min(-100).max(100).optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Proposal edit requires at least one adjustment.' });

const proposalArtifactSchema = z
  .object({
    accessScope: z.literal('local_private'),
    artifactId: z.string().trim().min(1),
    byteLength: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
    colorPipeline: z
      .object({
        encodedProfile: z.literal('srgb-preview'),
        outputProfile: z.literal('srgb'),
        previewTransform: z.literal('editor-preview-to-srgb-jpeg'),
        workingSpace: z.literal('rawengine-scene-linear'),
      })
      .strict(),
    contentHash: sha256Schema,
    dimensions: z
      .object({
        height: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    encodedFormat: z.literal('jpeg'),
    expiresAt: z.iso.datetime(),
    mediaType: z.literal('image/jpeg'),
    quality: z.literal(0.86),
    renderHash: sha256Schema,
    recipeHash: sha256Schema,
  })
  .strict();

const proposalStatusSchema = z.enum([
  'rendering',
  'ready',
  'stale',
  'superseded',
  'cancelled',
  'timed_out',
  'failed',
  'released',
]);

export const rawEngineAgentSelectedImageProposalRenderCommandV1Schema = z
  .object({
    basePreview: z
      .object({
        artifactId: z.string().trim().min(1),
        contentHash: sha256Schema,
      })
      .strict(),
    cancellationId: z.string().trim().min(1),
    commandType: z.literal(RawEngineAgentSelectedImageProposalCommandType.Render),
    deadlineAt: z.iso.datetime(),
    dryRun: z.literal(true),
    dryRunPlan: z
      .object({
        planHash: z.string().trim().min(1),
        planId: z.string().trim().min(1),
        predictedGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    edit: z
      .object({
        kind: z.literal('basic_tone_v1'),
        patch: basicTonePatchSchema,
      })
      .strict(),
    expectedGraphRevision: z.string().trim().min(1),
    expectedRecipeHash: z.string().trim().min(1),
    expectedRenderHash: z.string().trim().min(1),
    expectedSelectedImagePath: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(1),
    lineage: z
      .object({
        callId: z.string().trim().min(1),
        parentCallId: z.string().trim().min(1).optional(),
      })
      .strict(),
    operationId: z.string().trim().min(1),
    requestedPreview: z
      .object({
        longEdgePx: z.literal(1536),
        maxBytes: z.literal(8 * 1024 * 1024),
        quality: z.literal(0.86),
      })
      .strict(),
    requestId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export const rawEngineAgentSelectedImageProposalReceiptV1Schema = z
  .object({
    artifacts: z
      .object({
        after: proposalArtifactSchema,
        before: proposalArtifactSchema,
      })
      .strict()
      .optional(),
    base: z
      .object({
        graphRevision: z.string().trim().min(1),
        previewArtifactId: z.string().trim().min(1),
        previewContentHash: sha256Schema,
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
        selectedImageId: sha256Schema,
      })
      .strict(),
    cleanupState: proposalStatusSchema,
    createdAt: z.iso.datetime(),
    dryRunPlan: z
      .object({
        planHash: z.string().trim().min(1),
        planId: z.string().trim().min(1),
        predictedGraphRevision: z.string().trim().min(1),
      })
      .strict(),
    edit: z
      .object({
        kind: z.literal('basic_tone_v1'),
        patch: basicTonePatchSchema,
      })
      .strict(),
    expiresAt: z.iso.datetime(),
    lineage: z
      .object({
        callId: z.string().trim().min(1),
        parentCallId: z.string().trim().min(1).optional(),
      })
      .strict(),
    proposalHash: sha256Schema,
    proposalId: z.string().trim().min(1),
    receiptHash: sha256Schema,
    render: z
      .object({
        deadlineAt: z.iso.datetime(),
        durationMs: z.number().int().nonnegative(),
        outcome: proposalStatusSchema,
        proposedRecipeHash: sha256Schema,
        proposedRenderHash: sha256Schema,
      })
      .strict(),
    schemaVersion: z.literal(1),
    status: proposalStatusSchema,
    warnings: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.status === 'ready' && receipt.artifacts === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Ready proposal receipts require before and after artifacts.',
        path: ['artifacts'],
      });
    }
    if (receipt.artifacts !== undefined) {
      if (receipt.artifacts.before.contentHash !== receipt.base.previewContentHash) {
        context.addIssue({
          code: 'custom',
          message: 'Proposal before artifact must match the bound base preview bytes.',
          path: ['artifacts', 'before', 'contentHash'],
        });
      }
      if (receipt.artifacts.before.artifactId !== receipt.base.previewArtifactId) {
        context.addIssue({
          code: 'custom',
          message: 'Proposal before artifact must match the bound base preview artifact.',
          path: ['artifacts', 'before', 'artifactId'],
        });
      }
    }
  });

export type RawEngineAgentSelectedImageProposalRenderCommandV1 = z.infer<
  typeof rawEngineAgentSelectedImageProposalRenderCommandV1Schema
>;
export type RawEngineAgentSelectedImageProposalReceiptV1 = z.infer<
  typeof rawEngineAgentSelectedImageProposalReceiptV1Schema
>;
