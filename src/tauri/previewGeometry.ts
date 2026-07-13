import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

import type { Adjustments } from '../utils/adjustments';
import { Invokes } from './commands';

const finite = z.number().finite();
const previewGeometryDataUrlSchema = z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,/u);

export const previewGeometryParamsSchema = z.object({
  distortion: finite,
  vertical: finite,
  horizontal: finite,
  rotate: finite,
  aspect: finite,
  scale: finite,
  x_offset: finite,
  y_offset: finite,
  lens_distortion_amount: finite,
  lens_vignette_amount: finite,
  lens_tca_amount: finite,
  lens_dist_k1: finite,
  lens_dist_k2: finite,
  lens_dist_k3: finite,
  lens_model: finite,
  tca_vr: finite,
  tca_vb: finite,
  vig_k1: finite,
  vig_k2: finite,
  vig_k3: finite,
  lens_distortion_enabled: z.boolean(),
  lens_tca_enabled: z.boolean(),
  lens_vignette_enabled: z.boolean(),
});

export type PreviewGeometryParams = z.infer<typeof previewGeometryParamsSchema>;

const previewGeometryTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('editor-setting'), quality: z.literal('interactive') }),
  z.object({
    kind: z.literal('long-edge'),
    longEdgePx: z.number().int().positive(),
    quality: z.enum(['interactive', 'settled']),
  }),
]);

export type PreviewGeometryTarget = Readonly<z.infer<typeof previewGeometryTargetSchema>>;

export type PreviewGeometryIdentity = Readonly<{
  sourceIdentity: string;
  geometryRevision: string;
  retouchRevision: string;
  target: PreviewGeometryTarget;
}>;

export interface PreviewGeometryRequest {
  sourceIdentity: string;
  params: PreviewGeometryParams;
  adjustments: Adjustments;
  showLines: boolean;
  target?: PreviewGeometryTarget;
}

export interface PreviewGeometryResult {
  dataUrl: string;
  identity: PreviewGeometryIdentity;
}

type InvokeCommand = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const DEFAULT_TARGET: PreviewGeometryTarget = Object.freeze({ kind: 'editor-setting', quality: 'interactive' });

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
};

const fnv1a32 = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const revisionOf = (value: unknown): string => fnv1a32(JSON.stringify(stableValue(value)));

const retouchAuthority = (adjustments: Adjustments) => ({
  aiPatches: adjustments.aiPatches,
  masks: adjustments.masks.filter(
    (mask) => mask.retouchCloneSource !== undefined || mask.retouchRemoveSource !== undefined,
  ),
});

export const buildPreviewGeometryIdentity = (request: PreviewGeometryRequest): PreviewGeometryIdentity => {
  const params = previewGeometryParamsSchema.parse(request.params);
  const target = previewGeometryTargetSchema.parse(request.target ?? DEFAULT_TARGET);
  return Object.freeze({
    sourceIdentity: z.string().min(1).parse(request.sourceIdentity),
    geometryRevision: revisionOf(params),
    retouchRevision: revisionOf(retouchAuthority(request.adjustments)),
    target,
  });
};

export const toPreviewGeometryInvokeArgs = (request: PreviewGeometryRequest) => {
  const target = previewGeometryTargetSchema.parse(request.target ?? DEFAULT_TARGET);
  return {
    params: previewGeometryParamsSchema.parse(request.params),
    jsAdjustments: request.adjustments,
    showLines: z.boolean().parse(request.showLines),
    target,
  };
};

export const requestPreviewGeometry = async (
  request: PreviewGeometryRequest,
  invokeCommand: InvokeCommand = invoke,
): Promise<PreviewGeometryResult> => {
  const identity = buildPreviewGeometryIdentity(request);
  const payload = await invokeCommand(Invokes.PreviewGeometryTransform, toPreviewGeometryInvokeArgs(request));
  return { dataUrl: previewGeometryDataUrlSchema.parse(payload), identity };
};
