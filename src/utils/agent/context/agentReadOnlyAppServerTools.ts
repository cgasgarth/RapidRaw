import { z } from 'zod';

import { useEditorStore } from '../../../store/useEditorStore';
import { buildAgentImageContextSnapshot } from './agentImageContextSnapshot';
import {
  AGENT_PREVIEW_MAX_PIXEL_COUNT,
  agentPreviewCompareArtifactResultSchema,
  agentPreviewCompareColorMetadataSchema,
  agentPreviewEnvelopeSchema,
  buildAgentPreviewEnvelope,
  stableAgentPreviewHash,
} from './agentPreviewEnvelope';

export const AGENT_STATE_GET_TOOL_NAME = 'rawengine.agent.state.get';
export const AGENT_PREVIEW_RENDER_TOOL_NAME = 'rawengine.agent.preview.render';
export const AGENT_PREVIEW_COMPARE_TOOL_NAME = 'rawengine.agent.preview.compare';
export const RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME = 'rawengine.image.get_preview';
export const AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX = 1536;
export const AGENT_MEDIUM_PREVIEW_QUALITY = 0.86;
export const AGENT_STATE_GET_INPUT_SCHEMA_NAME = 'AgentStateGetRequestV1';
export const AGENT_STATE_GET_OUTPUT_SCHEMA_NAME = 'AgentStateGetResponseV1';
export const AGENT_PREVIEW_RENDER_INPUT_SCHEMA_NAME = 'AgentPreviewRenderRequestV1';
export const AGENT_PREVIEW_RENDER_OUTPUT_SCHEMA_NAME = 'AgentPreviewRenderResponseV1';
export const AGENT_PREVIEW_COMPARE_INPUT_SCHEMA_NAME = 'AgentPreviewCompareRequestV1';
export const AGENT_PREVIEW_COMPARE_OUTPUT_SCHEMA_NAME = 'AgentPreviewCompareResponseV1';
export const RAW_ENGINE_IMAGE_GET_PREVIEW_INPUT_SCHEMA_NAME = 'RawEngineImageGetPreviewRequestV1';
export const RAW_ENGINE_IMAGE_GET_PREVIEW_OUTPUT_SCHEMA_NAME = 'RawEngineImageGetPreviewResponseV1';

export const agentStateGetRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const agentPreviewRenderRequestSchema = z
  .object({
    crop: z
      .object({
        height: z.number().positive().max(1),
        width: z.number().positive().max(1),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .refine((crop) => crop.x + crop.width <= 1, {
        message: 'Crop x + width must stay within normalized image bounds.',
        path: ['width'],
      })
      .refine((crop) => crop.y + crop.height <= 1, {
        message: 'Crop y + height must stay within normalized image bounds.',
        path: ['height'],
      })
      .optional(),
    expectedRecipeHash: z.string().trim().min(1).optional(),
    longEdgePx: z.number().int().min(256).max(2048).default(AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX),
    maxPixelCount: z
      .number()
      .int()
      .min(65_536)
      .max(AGENT_PREVIEW_MAX_PIXEL_COUNT)
      .default(AGENT_PREVIEW_MAX_PIXEL_COUNT),
    purpose: z.enum(['detail_review', 'initial_context', 'refresh']).default('refresh'),
    quality: z.number().min(0.5).max(0.95).default(AGENT_MEDIUM_PREVIEW_QUALITY),
    requestId: z.string().trim().min(1),
    zoom: z
      .object({
        centerX: z.number().min(0).max(1),
        centerY: z.number().min(0).max(1),
        scale: z.number().min(1).max(8),
      })
      .strict()
      .optional(),
  })
  .strict();

export const agentPreviewCompareRequestSchema = z
  .object({
    beforeGraphRevision: z.string().trim().min(1).optional(),
    beforeRecipeHash: z.string().trim().min(1).optional(),
    expectedRecipeHash: z.string().trim().min(1).optional(),
    longEdgePx: z.number().int().min(256).max(2048).default(AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX),
    maxPixelCount: z
      .number()
      .int()
      .min(65_536)
      .max(AGENT_PREVIEW_MAX_PIXEL_COUNT)
      .default(AGENT_PREVIEW_MAX_PIXEL_COUNT),
    quality: z.number().min(0.5).max(0.95).default(AGENT_MEDIUM_PREVIEW_QUALITY),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const rawEngineImageGetPreviewRequestSchema = z
  .object({
    expectedRecipeHash: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
  })
  .strict();

export const agentStateGetResponseSchema = z
  .object({
    requestId: z.string().trim().min(1),
    snapshot: z.unknown(),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(AGENT_STATE_GET_TOOL_NAME),
  })
  .strict();

export const agentPreviewRenderResponseSchema = z
  .object({
    preview: agentPreviewEnvelopeSchema,
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(AGENT_PREVIEW_RENDER_TOOL_NAME),
  })
  .strict();

export const agentPreviewCompareResponseSchema = z
  .object({
    compare: agentPreviewCompareArtifactResultSchema,
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(AGENT_PREVIEW_COMPARE_TOOL_NAME),
  })
  .strict();

export const rawEngineImageGetPreviewResponseSchema = z
  .object({
    color: agentPreviewCompareColorMetadataSchema.extend({
      note: z.literal(
        'Medium preview is display-referred sRGB JPEG metadata/handle only; it is not the original RAW or an export proof.',
      ),
    }),
    dimensions: z
      .object({
        height: z.number().int().positive(),
        longEdgePx: z.literal(AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX),
        maxPixelCount: z.number().int().min(65_536).max(AGENT_PREVIEW_MAX_PIXEL_COUNT),
        sourceHeight: z.number().int().positive(),
        sourceWidth: z.number().int().positive(),
        width: z.number().int().positive(),
      })
      .strict(),
    editRevision: z
      .object({
        graphRevision: z.string().trim().min(1),
        recipeHash: z.string().trim().min(1),
        renderHash: z.string().trim().min(1),
      })
      .strict(),
    preview: agentPreviewEnvelopeSchema,
    requestId: z.string().trim().min(1),
    staleRecipeHash: z.boolean(),
    toolName: z.literal(RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME),
  })
  .strict()
  .refine((response) => response.preview.purpose === 'initial_context', {
    message: 'Image get-preview returns the current initial medium preview context.',
    path: ['preview', 'purpose'],
  })
  .refine((response) => response.preview.longEdgePx === response.dimensions.longEdgePx, {
    message: 'Preview long edge must match dimensions metadata.',
    path: ['dimensions', 'longEdgePx'],
  })
  .refine((response) => response.preview.width === response.dimensions.width, {
    message: 'Preview width must match dimensions metadata.',
    path: ['dimensions', 'width'],
  })
  .refine((response) => response.preview.height === response.dimensions.height, {
    message: 'Preview height must match dimensions metadata.',
    path: ['dimensions', 'height'],
  })
  .refine((response) => response.preview.recipeHash === response.editRevision.recipeHash, {
    message: 'Preview recipe hash must match edit revision metadata.',
    path: ['editRevision', 'recipeHash'],
  })
  .refine((response) => response.preview.renderHash === response.editRevision.renderHash, {
    message: 'Preview render hash must match edit revision metadata.',
    path: ['editRevision', 'renderHash'],
  });

export type AgentStateGetRequest = z.infer<typeof agentStateGetRequestSchema>;
export type AgentPreviewRenderRequest = z.input<typeof agentPreviewRenderRequestSchema>;
export type AgentPreviewCompareRequest = z.input<typeof agentPreviewCompareRequestSchema>;
export type RawEngineImageGetPreviewRequest = z.infer<typeof rawEngineImageGetPreviewRequestSchema>;
export type AgentStateGetResponse = z.infer<typeof agentStateGetResponseSchema>;
export type AgentPreviewRenderResponse = z.infer<typeof agentPreviewRenderResponseSchema>;
export type AgentPreviewCompareResponse = z.infer<typeof agentPreviewCompareResponseSchema>;
export type RawEngineImageGetPreviewResponse = z.infer<typeof rawEngineImageGetPreviewResponseSchema>;

export const getAgentReadOnlyState = (request: AgentStateGetRequest): AgentStateGetResponse => {
  const parsedRequest = agentStateGetRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();

  return agentStateGetResponseSchema.parse({
    requestId: parsedRequest.requestId,
    snapshot,
    staleRecipeHash:
      parsedRequest.expectedRecipeHash !== undefined &&
      parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash,
    toolName: AGENT_STATE_GET_TOOL_NAME,
  });
};

export const renderAgentReadOnlyPreview = (request: AgentPreviewRenderRequest): AgentPreviewRenderResponse => {
  const parsedRequest = agentPreviewRenderRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  const crop =
    parsedRequest.crop === undefined
      ? snapshot.initialPreview.crop
      : {
          ...parsedRequest.crop,
          unit: 'normalized' as const,
        };
  const preview = buildAgentPreviewEnvelope({
    crop,
    height: snapshot.initialPreview.height,
    idSeed: `${snapshot.initialPreview.id}:${parsedRequest.requestId}`,
    longEdgePx: parsedRequest.longEdgePx,
    maxPixelCount: parsedRequest.maxPixelCount,
    previewRef: snapshot.initialPreview.previewRef,
    purpose: parsedRequest.purpose,
    quality: parsedRequest.quality,
    recipeHash: snapshot.initialPreview.recipeHash,
    renderHash: snapshot.initialPreview.renderHash,
    width: snapshot.initialPreview.width,
    zoom: parsedRequest.zoom ?? null,
  });

  return agentPreviewRenderResponseSchema.parse({
    preview,
    requestId: parsedRequest.requestId,
    staleRecipeHash:
      parsedRequest.expectedRecipeHash !== undefined &&
      parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash,
    toolName: AGENT_PREVIEW_RENDER_TOOL_NAME,
  });
};

export const getRawEngineImagePreview = (
  request: RawEngineImageGetPreviewRequest,
): RawEngineImageGetPreviewResponse => {
  const parsedRequest = rawEngineImageGetPreviewRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  const selectedImage = useEditorStore.getState().selectedImage;
  if (selectedImage === null) {
    throw new Error('Cannot get image preview without a selected image.');
  }
  const preview = buildAgentPreviewEnvelope({
    crop: snapshot.initialPreview.crop,
    height: snapshot.initialPreview.height,
    idSeed: `${snapshot.initialPreview.id}:${RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME}:${parsedRequest.requestId}`,
    longEdgePx: AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX,
    maxPixelCount: AGENT_PREVIEW_MAX_PIXEL_COUNT,
    previewRef: snapshot.initialPreview.previewRef,
    purpose: 'initial_context',
    quality: AGENT_MEDIUM_PREVIEW_QUALITY,
    recipeHash: snapshot.initialPreview.recipeHash,
    renderHash: snapshot.initialPreview.renderHash,
    width: snapshot.initialPreview.width,
    zoom: snapshot.initialPreview.zoom,
  });

  return rawEngineImageGetPreviewResponseSchema.parse({
    color: {
      encodedProfile: 'srgb-preview',
      note: 'Medium preview is display-referred sRGB JPEG metadata/handle only; it is not the original RAW or an export proof.',
      outputProfile: 'srgb',
      previewTransform: 'editor-preview-to-srgb-jpeg',
      workingSpace: 'rawengine-scene-linear',
    },
    dimensions: {
      height: preview.height,
      longEdgePx: preview.longEdgePx,
      maxPixelCount: preview.maxPixelCount,
      sourceHeight: selectedImage.height,
      sourceWidth: selectedImage.width,
      width: preview.width,
    },
    editRevision: {
      graphRevision: snapshot.graphRevision,
      recipeHash: preview.recipeHash,
      renderHash: preview.renderHash,
    },
    preview,
    requestId: parsedRequest.requestId,
    staleRecipeHash:
      parsedRequest.expectedRecipeHash !== undefined &&
      parsedRequest.expectedRecipeHash !== snapshot.initialPreview.recipeHash,
    toolName: RAW_ENGINE_IMAGE_GET_PREVIEW_TOOL_NAME,
  });
};

const buildCompareArtifact = ({
  graphRevision,
  idSeed,
  previewRef,
  recipeHash,
  renderHash,
  role,
  snapshot,
  longEdgePx,
  maxPixelCount,
  quality,
}: {
  graphRevision: string;
  idSeed: string;
  longEdgePx: number;
  maxPixelCount: number;
  previewRef: string;
  quality: number;
  recipeHash: string;
  renderHash: string;
  role: 'before' | 'current';
  snapshot: ReturnType<typeof buildAgentImageContextSnapshot>;
}) => {
  const preview = buildAgentPreviewEnvelope({
    crop: snapshot.initialPreview.crop,
    height: snapshot.initialPreview.height,
    idSeed,
    longEdgePx,
    maxPixelCount,
    previewRef,
    purpose: role === 'before' ? 'initial_context' : 'refresh',
    quality,
    recipeHash,
    renderHash,
    width: snapshot.initialPreview.width,
    zoom: snapshot.initialPreview.zoom,
  });

  const contentHashSeed = stableAgentPreviewHash(
    JSON.stringify({
      graphRevision,
      previewRef,
      recipeHash: preview.recipeHash,
      renderHash: preview.renderHash,
      role,
    }),
  );

  return {
    artifactId: preview.artifactId,
    contentHash: `sha256:${contentHashSeed}${stableAgentPreviewHash(`${contentHashSeed}:${role}`)}`,
    graphRevision,
    preview,
    recipeHash: preview.recipeHash,
    renderHash: preview.renderHash,
    role,
  };
};

export const renderAgentPreviewCompare = (request: AgentPreviewCompareRequest): AgentPreviewCompareResponse => {
  const parsedRequest = agentPreviewCompareRequestSchema.parse(request);
  const snapshot = buildAgentImageContextSnapshot();
  const beforeGraphRevision = parsedRequest.beforeGraphRevision ?? snapshot.graphRevision;
  const beforeRecipeHash = parsedRequest.beforeRecipeHash ?? snapshot.initialPreview.recipeHash;
  const currentGraphRevision = snapshot.graphRevision;
  const currentRecipeHash = snapshot.initialPreview.recipeHash;
  const staleRecipeHash =
    parsedRequest.expectedRecipeHash !== undefined && parsedRequest.expectedRecipeHash !== currentRecipeHash;

  const beforeArtifact = buildCompareArtifact({
    graphRevision: beforeGraphRevision,
    idSeed: `${snapshot.activeImagePath}:${beforeGraphRevision}:${parsedRequest.requestId}:before`,
    longEdgePx: parsedRequest.longEdgePx,
    maxPixelCount: parsedRequest.maxPixelCount,
    previewRef: `${snapshot.initialPreview.previewRef}#before-${beforeGraphRevision}`,
    quality: parsedRequest.quality,
    recipeHash: beforeRecipeHash,
    renderHash: `render:${stableAgentPreviewHash(`${beforeGraphRevision}:${beforeRecipeHash}`)}`,
    role: 'before',
    snapshot,
  });
  const currentArtifact = buildCompareArtifact({
    graphRevision: currentGraphRevision,
    idSeed: `${snapshot.activeImagePath}:${currentGraphRevision}:${parsedRequest.requestId}:current`,
    longEdgePx: parsedRequest.longEdgePx,
    maxPixelCount: parsedRequest.maxPixelCount,
    previewRef: snapshot.initialPreview.previewRef,
    quality: parsedRequest.quality,
    recipeHash: currentRecipeHash,
    renderHash: snapshot.initialPreview.renderHash,
    role: 'current',
    snapshot,
  });

  return agentPreviewCompareResponseSchema.parse({
    compare: {
      artifacts: [beforeArtifact, currentArtifact],
      color: {
        encodedProfile: 'srgb-preview',
        outputProfile: 'srgb',
        previewTransform: 'editor-preview-to-srgb-jpeg',
        workingSpace: 'rawengine-scene-linear',
      },
      lineage: {
        beforeGraphRevision,
        beforeRecipeHash,
        currentGraphRevision,
        currentRecipeHash,
        staleRecipeHash,
      },
      mediumPreview: {
        longEdgePx: parsedRequest.longEdgePx,
        maxPixelCount: parsedRequest.maxPixelCount,
        quality: parsedRequest.quality,
      },
      scopeSummary: {
        clipping: snapshot.clipping,
        histogramChannels: snapshot.histogramSummary.map((entry) => entry.channel),
        metadataKeys: snapshot.metadataSummary.map((entry) => entry.key),
      },
    },
    requestId: parsedRequest.requestId,
    staleRecipeHash,
    toolName: AGENT_PREVIEW_COMPARE_TOOL_NAME,
  });
};
