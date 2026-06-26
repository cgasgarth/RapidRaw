import { z } from 'zod';

import { buildAgentImageContextSnapshot, type AgentImageContextSnapshot } from './agentImageContextSnapshot';

export const agentInitialPromptContextSchema = z
  .object({
    imageContext: z.custom<AgentImageContextSnapshot>(),
    modelInput: z
      .object({
        activeImagePath: z.string().trim().min(1),
        currentAdjustments: z.array(z.object({ key: z.string().trim().min(1), value: z.unknown() }).strict()),
        graphRevision: z.string().trim().min(1),
        promptText: z.string().trim().min(1),
        safetyConstraints: z
          .object({
            allowOriginalRawTransfer: z.literal(false),
            requireTypedTools: z.literal(true),
            requireUserApprovalBeforeApply: z.literal(true),
          })
          .strict(),
        sessionId: z.string().trim().min(1),
        transport: z.literal('codex_app_server'),
      })
      .strict(),
    operationId: z.string().trim().min(1),
    preview: z
      .object({
        accessScope: z.literal('local_private'),
        artifactId: z.string().trim().min(1),
        encodedFormat: z.literal('jpeg'),
        longEdgePx: z.literal(1536),
        mediaType: z.literal('image/jpeg'),
        previewRef: z.string().trim().min(1),
        purpose: z.literal('initial_context'),
        quality: z.literal(0.86),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    prompt: z.string().trim().min(1),
    schemaVersion: z.literal(1),
    sessionId: z.string().trim().min(1),
  })
  .strict();

export type AgentInitialPromptContext = z.infer<typeof agentInitialPromptContextSchema>;

export const buildAgentInitialPromptContext = ({
  operationId,
  prompt,
  sessionId,
  snapshot = buildAgentImageContextSnapshot(),
}: {
  operationId: string;
  prompt: string;
  sessionId: string;
  snapshot?: AgentImageContextSnapshot;
}): AgentInitialPromptContext =>
  agentInitialPromptContextSchema.parse({
    imageContext: snapshot,
    modelInput: {
      activeImagePath: snapshot.activeImagePath,
      currentAdjustments: snapshot.adjustmentSummary,
      graphRevision: snapshot.graphRevision,
      promptText: prompt,
      safetyConstraints: {
        allowOriginalRawTransfer: false,
        requireTypedTools: true,
        requireUserApprovalBeforeApply: true,
      },
      sessionId,
      transport: 'codex_app_server',
    },
    operationId,
    preview: {
      accessScope: snapshot.initialPreview.accessScope,
      artifactId: snapshot.initialPreview.artifactId,
      encodedFormat: snapshot.initialPreview.encodedFormat,
      longEdgePx: snapshot.initialPreview.longEdgePx,
      mediaType: snapshot.initialPreview.mediaType,
      previewRef: snapshot.initialPreview.previewRef,
      purpose: snapshot.initialPreview.purpose,
      quality: snapshot.initialPreview.quality,
      recipeHash: snapshot.initialPreview.recipeHash,
      renderHash: snapshot.initialPreview.renderHash,
    },
    prompt,
    schemaVersion: 1,
    sessionId,
  });
