import { z } from 'zod';

export const EDIT_DOCUMENT_V2_SCHEMA_VERSION = 2;

export const EDIT_DOCUMENT_NODE_DESCRIPTORS = [
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {
      blacks: 0,
      brightness: 0,
      contrast: 0,
      exposure: 0,
      highlights: 0,
      saturation: 0,
      shadows: 0,
      whites: 0,
    },
    legacyFields: ['blacks', 'brightness', 'contrast', 'exposure', 'highlights', 'saturation', 'shadows', 'whites'],
    nodeType: 'scene_global_color_tone',
    process: 'scene_referred_v2',
    renderStage: 'scene_global_color_tone',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {},
    legacyFields: ['outputToneCurve', 'sceneCurve', 'toneCurve'],
    nodeType: 'scene_curve',
    process: 'scene_referred_v2',
    renderStage: 'scene_curve',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {},
    legacyFields: ['filmCurve', 'grainAmount', 'halationAmount', 'lutIntensity', 'vignetteAmount'],
    nodeType: 'display_creative',
    process: 'scene_referred_v2',
    renderStage: 'display_creative',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {},
    legacyFields: [
      'clarity',
      'colorNoiseReduction',
      'dehaze',
      'denoiseContrastProtection',
      'denoiseDetail',
      'denoiseNaturalGrain',
      'denoiseShadowBias',
      'lumaNoiseReduction',
      'sharpness',
    ],
    nodeType: 'detail_denoise_dehaze',
    process: 'scene_referred_v2',
    renderStage: 'detail_denoise_dehaze',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {},
    legacyFields: ['cameraProfile', 'temperature', 'tint', 'whiteBalance'],
    nodeType: 'camera_input',
    process: 'scene_referred_v2',
    renderStage: 'camera_input',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: true, copy: true, paste: true, provenance: 'strip', reset: true },
    defaultParams: {
      aspectRatio: null,
      crop: null,
      flipHorizontal: false,
      flipVertical: false,
      orientationSteps: 0,
      rotation: 0,
    },
    legacyFields: ['aspectRatio', 'crop', 'flipHorizontal', 'flipVertical', 'orientationSteps', 'rotation'],
    nodeType: 'geometry',
    process: 'legacy_pipeline_v1',
    renderStage: 'geometry',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: false, copy: false, paste: false, provenance: 'preserve', reset: false },
    defaultParams: {},
    legacyFields: ['masks'],
    nodeType: 'layers',
    process: 'scene_referred_v2',
    renderStage: 'layers',
    implementationVersion: 1,
  },
  {
    capabilities: { batch: false, copy: false, paste: false, provenance: 'regenerate', reset: false },
    defaultParams: {},
    legacyFields: ['aiPatches', 'generatedProfile', 'referenceMatchApplicationReceipt'],
    nodeType: 'source_artifacts',
    process: 'scene_referred_v2',
    renderStage: 'source_artifacts',
    implementationVersion: 1,
  },
] as const;

export const editDocumentNodeCapabilitySchema = z.object({
  batch: z.boolean(),
  copy: z.boolean(),
  paste: z.boolean(),
  provenance: z.enum(['preserve', 'regenerate', 'strip']),
  reset: z.boolean(),
});

export const editDocumentNodeDescriptorSchema = z.object({
  capabilities: editDocumentNodeCapabilitySchema,
  defaultParams: z.record(z.string(), z.unknown()),
  legacyFields: z.array(z.string()),
  nodeType: z.string(),
  process: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
  renderStage: z.string(),
  implementationVersion: z.number().int().positive(),
});

export const editDocumentNodeTypeV2Schema = z.enum(
  EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType) as [string, ...string[]],
);

export const editDocumentNodeEnvelopeV2Schema = z
  .object({
    enabled: z.boolean(),
    implementationVersion: z.number().int().positive(),
    params: z.record(z.string(), z.unknown()),
    process: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    type: editDocumentNodeTypeV2Schema,
  })
  .strict();

const editDocumentNodesV2Schema = z
  .record(editDocumentNodeTypeV2Schema, editDocumentNodeEnvelopeV2Schema)
  .superRefine((nodes, context) => {
    for (const [nodeType, node] of Object.entries(nodes)) {
      const descriptor = EDIT_DOCUMENT_NODE_DESCRIPTORS.find((candidate) => candidate.nodeType === nodeType);
      if (descriptor === undefined) continue;
      if (node.type !== nodeType) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node envelope type must match '${nodeType}'.` });
      }
      if (node.process !== descriptor.process) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' has an incompatible process.` });
      }
      if (node.implementationVersion !== descriptor.implementationVersion) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' has an unsupported version.` });
      }
      if (!hasFiniteJsonValues(node.params)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `Node '${nodeType}' contains a non-finite value.` });
      }
    }
  });

const editDocumentMigrationReceiptV2Schema = z
  .object({
    defaulted: z.array(z.string()),
    disabled: z.array(z.string()),
    mapped: z.array(z.string()),
    quarantined: z.array(z.string()),
    sourceSchemaVersion: z.literal(1),
  })
  .strict();

export const editDocumentV2Schema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    geometry: z.record(z.string(), z.unknown()),
    graphProcess: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    layers: z.record(z.string(), z.unknown()),
    migration: editDocumentMigrationReceiptV2Schema.optional(),
    nodes: editDocumentNodesV2Schema,
    provenance: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(EDIT_DOCUMENT_V2_SCHEMA_VERSION),
    sourceArtifacts: z.record(z.string(), z.unknown()),
  })
  .strict();

export type EditDocumentNodeTypeV2 = z.infer<typeof editDocumentNodeTypeV2Schema>;
export type EditDocumentNodeEnvelopeV2 = z.infer<typeof editDocumentNodeEnvelopeV2Schema>;
export type EditDocumentV2 = z.infer<typeof editDocumentV2Schema>;
export type EditDocumentMigrationReceiptV2 = z.infer<typeof editDocumentMigrationReceiptV2Schema>;

export interface CompiledEditDocumentNodeV2 {
  readonly enabled: boolean;
  readonly implementationVersion: number;
  readonly nodeType: EditDocumentNodeTypeV2;
  readonly params: Readonly<Record<string, unknown>>;
  readonly process: 'legacy_pipeline_v1' | 'scene_referred_v2';
  readonly renderStage: string;
}

/** Compile one validated envelope with descriptor-owned process and render-stage metadata. */
export const compileEditDocumentNodeV2 = (node: unknown): CompiledEditDocumentNodeV2 => {
  const envelope = editDocumentNodeEnvelopeV2Schema.parse(node);
  const descriptor = getEditDocumentNodeDescriptor(envelope.type);
  if (descriptor === undefined) throw new Error(`Unknown edit document node type: ${envelope.type}`);
  if (envelope.process !== descriptor.process) throw new Error(`Node '${envelope.type}' has an incompatible process.`);
  if (envelope.implementationVersion !== descriptor.implementationVersion) {
    throw new Error(`Node '${envelope.type}' has an unsupported version.`);
  }
  return {
    enabled: envelope.enabled,
    implementationVersion: envelope.implementationVersion,
    nodeType: envelope.type,
    params: envelope.params,
    process: envelope.process,
    renderStage: descriptor.renderStage,
  };
};

/** Compile the complete graph in descriptor order so render stages have stable authority. */
export const compileEditDocumentV2 = (document: EditDocumentV2): readonly CompiledEditDocumentNodeV2[] => {
  const parsed = editDocumentV2Schema.parse(document);
  return EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap(({ nodeType }) => {
    const node = parsed.nodes[nodeType];
    return node === undefined ? [] : [compileEditDocumentNodeV2(node)];
  });
};

export const parseEditDocumentV2 = (value: unknown): EditDocumentV2 => editDocumentV2Schema.parse(value);

const editDocumentV2QuarantineInputSchema = z
  .object({
    extensions: z.record(z.string(), z.unknown()),
    geometry: z.record(z.string(), z.unknown()),
    graphProcess: z.enum(['legacy_pipeline_v1', 'scene_referred_v2']),
    layers: z.record(z.string(), z.unknown()),
    migration: editDocumentMigrationReceiptV2Schema.optional(),
    nodes: z.record(z.string(), z.unknown()),
    provenance: z.record(z.string(), z.unknown()),
    schemaVersion: z.literal(EDIT_DOCUMENT_V2_SCHEMA_VERSION),
    sourceArtifacts: z.record(z.string(), z.unknown()),
  })
  .strict();

export const parseEditDocumentV2WithQuarantine = (
  value: unknown,
): { document: EditDocumentV2; quarantinedNodeTypes: readonly string[] } => {
  const raw = editDocumentV2QuarantineInputSchema.parse(value);
  const knownTypes: ReadonlySet<string> = new Set(EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => nodeType));
  const knownNodes = Object.fromEntries(Object.entries(raw.nodes).filter(([nodeType]) => knownTypes.has(nodeType)));
  const quarantinedNodes = Object.fromEntries(
    Object.entries(raw.nodes).filter(([nodeType]) => !knownTypes.has(nodeType)),
  );
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally carries quarantined future nodes.
  const existingQuarantine = raw.extensions['quarantinedNodes'];
  const extensions = {
    ...raw.extensions,
    ...(Object.keys(quarantinedNodes).length > 0
      ? {
          quarantinedNodes: {
            ...(existingQuarantine && typeof existingQuarantine === 'object' ? existingQuarantine : {}),
            ...quarantinedNodes,
          },
        }
      : {}),
  };
  const migration = raw.migration
    ? {
        ...raw.migration,
        quarantined: [...new Set([...raw.migration.quarantined, ...Object.keys(quarantinedNodes)])].sort(),
      }
    : undefined;
  const document = editDocumentV2Schema.parse({ ...raw, extensions, migration, nodes: knownNodes });
  return { document, quarantinedNodeTypes: Object.keys(quarantinedNodes).sort() };
};

export const getEditDocumentNodeDescriptor = (nodeType: EditDocumentNodeTypeV2) =>
  EDIT_DOCUMENT_NODE_DESCRIPTORS.find((descriptor) => descriptor.nodeType === nodeType);

const hasFiniteJsonValues = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasFiniteJsonValues);
  if (value !== null && typeof value === 'object') return Object.values(value).every(hasFiniteJsonValues);
  return true;
};
