import { z } from 'zod';

export const EDIT_DOCUMENT_V2_SCHEMA_VERSION = 2;

export const EDIT_DOCUMENT_NODE_DESCRIPTORS = [
  { nodeType: 'scene_global_color_tone', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'scene_curve', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'display_creative', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'detail_denoise_dehaze', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'camera_input', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'geometry', process: 'legacy_pipeline_v1', implementationVersion: 1 },
  { nodeType: 'layers', process: 'scene_referred_v2', implementationVersion: 1 },
  { nodeType: 'source_artifacts', process: 'scene_referred_v2', implementationVersion: 1 },
] as const;

export const editDocumentNodeTypeV2Schema = z.enum(
  EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType) as [string, ...string[]],
);

const editDocumentNodeEnvelopeV2Schema = z
  .object({
    enabled: z.boolean(),
    implementationVersion: z.number().int().positive(),
    params: z.record(z.string(), z.unknown()),
    process: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    type: editDocumentNodeTypeV2Schema,
  })
  .strict();

export const editDocumentV2Schema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    geometry: z.record(z.string(), z.unknown()),
    graphProcess: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    layers: z.record(z.string(), z.unknown()),
    nodes: z.record(editDocumentNodeTypeV2Schema, editDocumentNodeEnvelopeV2Schema),
    provenance: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(EDIT_DOCUMENT_V2_SCHEMA_VERSION),
    sourceArtifacts: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EditDocumentNodeTypeV2 = z.infer<typeof editDocumentNodeTypeV2Schema>;
export type EditDocumentNodeEnvelopeV2 = z.infer<typeof editDocumentNodeEnvelopeV2Schema>;
export type EditDocumentV2 = z.infer<typeof editDocumentV2Schema>;

export const parseEditDocumentV2 = (value: unknown): EditDocumentV2 => editDocumentV2Schema.parse(value);
