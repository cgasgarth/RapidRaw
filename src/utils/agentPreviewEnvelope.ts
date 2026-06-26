import { z } from 'zod';

export const AGENT_MEDIUM_PREVIEW_LONG_EDGE_PX = 1536;
export const AGENT_MEDIUM_PREVIEW_QUALITY = 0.86;
export const AGENT_PREVIEW_MAX_PIXEL_COUNT = 4_194_304;

export const agentPreviewPurposeSchema = z.enum(['detail_review', 'initial_context', 'refresh']);

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
