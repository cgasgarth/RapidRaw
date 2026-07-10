import { z } from 'zod';

import { type AgentImageContextSnapshot, buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import { type AgentModelImageAttachment, agentModelImageAttachmentSchema } from './agentMediumPreviewAttachmentRuntime';
import { RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME } from './agentReadOnlyAppServerTools';

export const agentInitialPromptContextSchema = z
  .object({
    imageContext: z.custom<AgentImageContextSnapshot>(),
    modelInput: z
      .object({
        activeImagePath: z.string().trim().min(1),
        attachments: z.array(agentModelImageAttachmentSchema).max(1),
        currentAdjustments: z.array(z.object({ key: z.string().trim().min(1), value: z.unknown() }).strict()),
        graphRevision: z.string().trim().min(1),
        initialPreview: z
          .object({
            accessScope: z.literal('local_private'),
            artifactId: z.string().trim().min(1),
            colorProfile: z.literal('srgb-preview'),
            encodedFormat: z.literal('jpeg'),
            height: z.number().int().positive(),
            includesOriginalRaw: z.literal(false),
            longEdgePx: z.literal(1536),
            mediaType: z.literal('image/jpeg'),
            previewRef: z.string().trim().min(1),
            purpose: z.literal('initial_context'),
            quality: z.literal(0.86),
            recipeHash: z.string().trim().min(1),
            renderHash: z.string().trim().min(1),
            toolName: z.literal(RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME),
            width: z.number().int().positive(),
          })
          .strict(),
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
        toolName: z.literal(RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME),
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
      attachments: [],
      currentAdjustments: snapshot.adjustmentSummary,
      graphRevision: snapshot.graphRevision,
      initialPreview: {
        accessScope: snapshot.initialPreview.accessScope,
        artifactId: snapshot.initialPreview.artifactId,
        colorProfile: snapshot.initialPreview.colorProfile,
        encodedFormat: snapshot.initialPreview.encodedFormat,
        height: snapshot.initialPreview.height,
        includesOriginalRaw: snapshot.initialPreview.includesOriginalRaw,
        longEdgePx: snapshot.initialPreview.longEdgePx,
        mediaType: snapshot.initialPreview.mediaType,
        previewRef: snapshot.initialPreview.previewRef,
        purpose: snapshot.initialPreview.purpose,
        quality: snapshot.initialPreview.quality,
        recipeHash: snapshot.initialPreview.recipeHash,
        renderHash: snapshot.initialPreview.renderHash,
        toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
        width: snapshot.initialPreview.width,
      },
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
      toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
    },
    prompt,
    schemaVersion: 1,
    sessionId,
  });

export const bindAgentInitialPromptContextAttachment = ({
  attachment,
  context,
}: {
  attachment: AgentModelImageAttachment;
  context: AgentInitialPromptContext;
}): AgentInitialPromptContext => {
  const preview = attachment.attachment;
  if (
    preview.revision.graphRevision !== context.imageContext.graphRevision ||
    preview.revision.recipeHash !== context.imageContext.initialPreview.recipeHash ||
    preview.revision.renderHash !== context.imageContext.initialPreview.renderHash
  ) {
    throw new Error('Initial model attachment does not match the selected-image context revision.');
  }
  return agentInitialPromptContextSchema.parse({
    ...context,
    modelInput: {
      ...context.modelInput,
      attachments: [attachment],
    },
  });
};
