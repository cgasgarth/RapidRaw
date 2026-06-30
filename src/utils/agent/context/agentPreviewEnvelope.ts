import { z } from 'zod';

export const AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX = 1536;
export const AGENT_MEDIUM_PREVIEW_QUALITY = 0.86;
export const AGENT_PREVIEW_MAX_PIXEL_COUNT = 4_194_304;

export const agentPreviewPurposeSchema = z.enum(['detail_review', 'initial_context', 'refresh']);
export const agentPreviewCompareRoleSchema = z.enum(['before', 'current']);

export const agentPreviewEnvelopeSchema = z
  .object({
    accessScope: z.literal('local_private'),
    artifactId: z.string().trim().min(1),
    cacheKey: z.string().trim().min(1),
    cachePolicy: z
      .object({
        invalidatesOn: z
          .array(z.enum(['crop', 'image_selection', 'mask_stack', 'recipe_hash', 'render_settings']))
          .min(1),
        stableWhenRecipeHashMatches: z.boolean(),
      })
      .strict(),
    colorProfile: z.literal('srgb-preview'),
    crop: z
      .object({
        height: z.number().positive(),
        unit: z.enum(['%', 'normalized', 'px']),
        width: z.number().positive(),
        x: z.number(),
        y: z.number(),
      })
      .strict()
      .nullable(),
    encodedFormat: z.literal('jpeg'),
    height: z.number().int().positive(),
    id: z.string().trim().min(1),
    includesOriginalRaw: z.literal(false),
    lifecycle: z
      .object({
        expiresWith: z.array(z.enum(['image_selection_change', 'recipe_hash_change', 'session_cancel'])).min(1),
        persisted: z.literal(false),
        storage: z.literal('ephemeral_editor_cache'),
      })
      .strict(),
    longEdgePx: z.number().int().min(256).max(2048),
    maxPixelCount: z.number().int().min(65_536).max(AGENT_PREVIEW_MAX_PIXEL_COUNT),
    mediaType: z.literal('image/jpeg'),
    previewRef: z.string().trim().min(1),
    purpose: agentPreviewPurposeSchema,
    quality: z.number().min(0.5).max(0.95),
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
    renderIntent: agentPreviewPurposeSchema,
    source: z.literal('editor-preview-derivative'),
    width: z.number().int().positive(),
    zoom: z
      .object({
        centerX: z.number().min(0).max(1),
        centerY: z.number().min(0).max(1),
        scale: z.number().min(1).max(8),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((preview) => preview.purpose === preview.renderIntent, {
    message: 'Preview purpose and render intent must match.',
    path: ['renderIntent'],
  });

export type AgentPreviewEnvelope = z.infer<typeof agentPreviewEnvelopeSchema>;
export type AgentPreviewCompareRole = z.infer<typeof agentPreviewCompareRoleSchema>;
export type AgentPreviewPurpose = z.infer<typeof agentPreviewPurposeSchema>;

export const stableAgentPreviewHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export type AgentPreviewEnvelopeInput = {
  crop: AgentPreviewEnvelope['crop'];
  height: number;
  idSeed: string;
  longEdgePx?: number;
  maxPixelCount?: number;
  previewRef: string;
  purpose?: AgentPreviewPurpose;
  quality?: number;
  recipeHash: string;
  renderHash: string;
  stableHash?: (value: string) => string;
  width: number;
  zoom?: AgentPreviewEnvelope['zoom'];
};

const fitPreviewDimensions = (
  width: number,
  height: number,
  longEdgePx: number,
  maxPixelCount: number,
): { height: number; width: number } => {
  const longEdge = Math.max(width, height);
  if (longEdge <= 0) return { height: longEdgePx, width: longEdgePx };

  const scale = longEdgePx / longEdge;
  const initial = {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
  const pixelCount = initial.width * initial.height;
  if (pixelCount <= maxPixelCount) return initial;

  const budgetScale = Math.sqrt(maxPixelCount / pixelCount);
  return {
    height: Math.max(1, Math.floor(initial.height * budgetScale)),
    width: Math.max(1, Math.floor(initial.width * budgetScale)),
  };
};

export const buildAgentPreviewEnvelope = (input: AgentPreviewEnvelopeInput): AgentPreviewEnvelope => {
  const purpose = input.purpose ?? 'initial_context';
  const longEdgePx = input.longEdgePx ?? AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX;
  const maxPixelCount = input.maxPixelCount ?? AGENT_PREVIEW_MAX_PIXEL_COUNT;
  const quality = input.quality ?? AGENT_MEDIUM_PREVIEW_QUALITY;
  const cropWidth = input.crop?.unit === 'normalized' ? input.width * input.crop.width : input.width;
  const cropHeight = input.crop?.unit === 'normalized' ? input.height * input.crop.height : input.height;
  const dimensions = fitPreviewDimensions(cropWidth, cropHeight, longEdgePx, maxPixelCount);
  const stableHash = input.stableHash ?? stableAgentPreviewHash;
  const variantHash = stableHash(
    JSON.stringify({
      crop: input.crop,
      longEdgePx,
      maxPixelCount,
      previewRef: input.previewRef,
      purpose,
      quality,
      recipeHash: input.recipeHash,
      renderHash: input.renderHash,
      zoom: input.zoom ?? null,
    }),
  );

  const artifactId = `artifact_${purpose}_${variantHash}`;

  return agentPreviewEnvelopeSchema.parse({
    accessScope: 'local_private',
    artifactId,
    cacheKey: `agent-preview:${purpose}:${variantHash}`,
    cachePolicy: {
      invalidatesOn: ['image_selection', 'recipe_hash', 'render_settings', 'crop', 'mask_stack'],
      stableWhenRecipeHashMatches: true,
    },
    colorProfile: 'srgb-preview',
    crop: input.crop,
    encodedFormat: 'jpeg',
    height: dimensions.height,
    id: `${purpose}_${stableHash(`${input.idSeed}:${variantHash}`)}`,
    includesOriginalRaw: false,
    lifecycle: {
      expiresWith: ['session_cancel', 'recipe_hash_change', 'image_selection_change'],
      persisted: false,
      storage: 'ephemeral_editor_cache',
    },
    longEdgePx,
    maxPixelCount,
    mediaType: 'image/jpeg',
    previewRef: input.previewRef,
    purpose,
    quality,
    recipeHash: input.recipeHash,
    renderHash: `render:${variantHash}`,
    renderIntent: purpose,
    source: 'editor-preview-derivative',
    width: dimensions.width,
    zoom: input.zoom ?? null,
  });
};

export const isAgentPreviewEnvelopeCurrent = ({
  preview,
  recipeHash,
}: {
  preview: AgentPreviewEnvelope;
  recipeHash: string;
}): boolean => preview.recipeHash === recipeHash && !preview.lifecycle.persisted;

export const agentPreviewCompareArtifactSchema = z
  .object({
    artifactId: z.string().trim().min(1),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{16,64}$/u),
    graphRevision: z.string().trim().min(1),
    preview: agentPreviewEnvelopeSchema,
    recipeHash: z.string().trim().min(1),
    renderHash: z.string().trim().min(1),
    role: agentPreviewCompareRoleSchema,
  })
  .strict()
  .refine((artifact) => artifact.preview.artifactId === artifact.artifactId, {
    message: 'Compare artifact id must match preview artifact id.',
    path: ['artifactId'],
  })
  .refine((artifact) => artifact.preview.recipeHash === artifact.recipeHash, {
    message: 'Compare artifact recipe hash must match preview recipe hash.',
    path: ['recipeHash'],
  });

export const agentPreviewCompareScopeSummarySchema = z
  .object({
    clipping: z
      .object({
        highlightsPercent: z.number().min(0).max(100),
        shadowsPercent: z.number().min(0).max(100),
      })
      .strict(),
    histogramChannels: z.array(z.string().trim().min(1)).min(1).max(4),
    metadataKeys: z.array(z.string().trim().min(1)).max(8),
  })
  .strict();

export const agentPreviewCompareLineageSchema = z
  .object({
    beforeGraphRevision: z.string().trim().min(1),
    beforeRecipeHash: z.string().trim().min(1),
    currentGraphRevision: z.string().trim().min(1),
    currentRecipeHash: z.string().trim().min(1),
    staleRecipeHash: z.boolean(),
  })
  .strict();

export const agentPreviewCompareColorMetadataSchema = z
  .object({
    encodedProfile: z.literal('srgb-preview'),
    outputProfile: z.literal('srgb'),
    previewTransform: z.literal('editor-preview-to-srgb-jpeg'),
    workingSpace: z.literal('rawengine-scene-linear'),
  })
  .strict();

export const agentPreviewCompareArtifactResultSchema = z
  .object({
    artifacts: z.tuple([agentPreviewCompareArtifactSchema, agentPreviewCompareArtifactSchema]),
    color: agentPreviewCompareColorMetadataSchema,
    lineage: agentPreviewCompareLineageSchema,
    mediumPreview: z
      .object({
        longEdgePx: z.number().int().min(256).max(2048),
        maxPixelCount: z.number().int().min(65_536).max(AGENT_PREVIEW_MAX_PIXEL_COUNT),
        quality: z.number().min(0.5).max(0.95),
      })
      .strict(),
    scopeSummary: agentPreviewCompareScopeSummarySchema,
  })
  .strict()
  .refine((result) => result.artifacts[0].role === 'before' && result.artifacts[1].role === 'current', {
    message: 'Compare artifacts must be ordered before/current.',
    path: ['artifacts'],
  })
  .refine((result) => result.artifacts[0].preview.cacheKey !== result.artifacts[1].preview.cacheKey, {
    message: 'Before/current compare previews must use distinct cache keys.',
    path: ['artifacts'],
  });

export type AgentPreviewCompareArtifact = z.infer<typeof agentPreviewCompareArtifactSchema>;
export type AgentPreviewCompareArtifactResult = z.infer<typeof agentPreviewCompareArtifactResultSchema>;
