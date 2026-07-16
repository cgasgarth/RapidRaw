import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentNodeEnvelopeV2,
  type EditDocumentNodeParamsV2,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  type EditDocumentV2CopyPayload,
  editDocumentGeometryV2Schema,
  editDocumentLayersV2Schema,
  editDocumentNodeEnvelopeV2Schema,
  editDocumentSourceArtifactsV2Schema,
  editDocumentSourceDecodeV2Schema,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { layerStackSidecarPersistenceEnvelopeV1Schema } from '../../packages/rawengine-schema/src/layerStackSidecarPersistence';
import { type Adjustments, INITIAL_ADJUSTMENTS } from './adjustments';

const descriptorFor = (nodeType: EditDocumentNodeTypeV2) => getEditDocumentNodeDescriptor(nodeType);
const normalizeGeometryParams = (params: Readonly<Record<string, unknown>>) =>
  editDocumentGeometryV2Schema.parse(params);

/** Build the editor's current document authority directly from node descriptors. */
export const createDefaultEditDocumentV2 = (): EditDocumentV2 => {
  const nodes = Object.fromEntries(
    EDIT_DOCUMENT_NODE_DESCRIPTORS.map((descriptor) => [
      descriptor.nodeType,
      {
        enabled: true,
        implementationVersion: descriptor.implementationVersion,
        params: structuredClone(descriptor.defaultParams),
        process: descriptor.process,
        type: descriptor.nodeType,
      },
    ]),
  );
  const nodeParams = (nodeType: EditDocumentNodeTypeV2): Record<string, unknown> => {
    const node = nodes[nodeType];
    if (node === undefined) throw new Error(`edit_document.default_node_missing:${nodeType}`);
    return node.params;
  };
  return editDocumentV2Schema.parse({
    extensions: { legacyAdjustments },
    geometry: nodeParams('geometry'),
    graphProcess: 'scene_referred_v2',
    layers: nodeParams('layers'),
    nodes,
    provenance: { referenceMatchApplicationReceipt: null },
    schemaVersion: 2,
    sourceDecode: nodeParams('source_decode'),
    sourceArtifacts: nodeParams('source_artifacts'),
  });
};

const readEffectsEnabled = (adjustments: Readonly<Record<string, unknown>>): boolean => {
  // biome-ignore lint/complexity/useLiteralKeys: the migration adapter intentionally accepts an index signature.
  if (typeof adjustments['effectsEnabled'] === 'boolean') return adjustments['effectsEnabled'];
  // biome-ignore lint/complexity/useLiteralKeys: the migration adapter intentionally accepts an index signature.
  const legacyVisibility = adjustments['sectionVisibility'];
  return hasRecordShape(legacyVisibility) && typeof legacyVisibility['effects'] === 'boolean'
    ? legacyVisibility['effects']
    : true;
};

const readLegacySectionEnabled = (
  adjustments: Readonly<Record<string, unknown>>,
  section: 'basic' | 'color' | 'curves' | 'details',
): boolean => {
  // biome-ignore lint/complexity/useLiteralKeys: the adapter owns the legacy index-signature boundary.
  const visibility = adjustments['sectionVisibility'];
  return hasRecordShape(visibility) && typeof visibility[section] === 'boolean' ? visibility[section] : true;
};

const parseCurrentLayers = (params: Readonly<Record<string, unknown>>) =>
  editDocumentLayersV2Schema.parse({
    ...params,
    masks: Array.isArray(params['masks']) ? params['masks'] : [],
  });

const STRICT_LEGACY_NODE_PARAM_SCHEMAS: Partial<Record<EditDocumentNodeTypeV2, z.ZodType>> = {
  black_white_mixer: editDocumentBlackWhiteMixerV2Schema,
  camera_input: editDocumentCameraInputV2Schema,
  channel_mixer: editDocumentChannelMixerV2Schema,
  color_balance_rgb: editDocumentColorBalanceRgbV2Schema,
  color_calibration: editDocumentColorCalibrationV2Schema,
  detail_denoise_dehaze: editDocumentDetailDenoiseDehazeV2Schema,
  display_creative: editDocumentDisplayCreativeV2Schema,
  film_emulation: editDocumentFilmEmulationV2Schema,
  lens_correction: editDocumentLensCorrectionV2Schema,
  luma_levels: editDocumentLumaLevelsV2Schema,
  perceptual_grading: editDocumentPerceptualGradingV2Schema,
  point_color: editDocumentPointColorV2Schema,
  color_presence: editDocumentColorPresenceV2Schema,
  scene_global_color_tone: sceneGlobalColorToneParamsV2Schema,
  scene_to_view_transform: editDocumentSceneToViewTransformV2Schema,
  scene_curve: editDocumentSceneCurveV2Schema,
  selective_color_mixer: editDocumentSelectiveColorMixerV2Schema,
  skin_tone_uniformity: editDocumentSkinToneUniformityV2Schema,
  source_decode: editDocumentSourceDecodeV2Schema,
  tone_equalizer: editDocumentToneEqualizerV2Schema,
};

const normalizeMappedNodeParams = (
  nodeType: EditDocumentNodeTypeV2,
  defaults: Readonly<Record<string, unknown>>,
  mappedParams: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const candidate = { ...defaults, ...mappedParams };
  if (nodeType === 'geometry') return normalizeGeometryParams(candidate);
  if (nodeType === 'layers') return parseCurrentLayers({ masks: [], ...mappedParams });
  const schema = STRICT_LEGACY_NODE_PARAM_SCHEMAS[nodeType];
  if (schema === undefined) return { ...mappedParams };
  const parsed = schema.parse(candidate);
  if (!hasRecordShape(parsed)) throw new Error(`EditDocumentV2 node '${nodeType}' params must be an object.`);
  return { ...parsed };
};

export const legacyAdjustmentsToEditDocumentV2 = (adjustments: Readonly<Record<string, unknown>>): EditDocumentV2 => {
  for (const field of ['filmLookId', 'filmLookStrength']) {
    if (Object.hasOwn(adjustments, field)) {
      throw new Error(`EditDocumentV2 rejects retired pre-node Film field '${field}'.`);
    }
  }
  const entries = Object.entries(adjustments);
  const layerStackArtifacts = layerStackSidecarPersistenceEnvelopeV1Schema.safeParse({
    rawEngineArtifacts: adjustments['rawEngineArtifacts'],
  });
  const quarantinedOwnedEntries = entries.filter(([key, value]) => {
    const schema = migratedOwnedFieldSchema(key);
    return schema !== undefined && !schema.safeParse(value).success;
  });
  const quarantinedOwnedFields = new Set<string>(quarantinedOwnedEntries.map(([key]) => key));
  const effectsEnabled = readEffectsEnabled(adjustments);
  const disabledNodeTypes = new Set<EditDocumentNodeTypeV2>(
    (['basic', 'color', 'curves', 'details'] as const).flatMap((section) =>
      readLegacySectionEnabled(adjustments, section) ? [] : getEditDocumentNodeTypesForEditorSection(section),
    ),
  );
  const mapped = entries
    .map(([key]) => ({ key, nodeType: nodeTypeForField(key) }))
    .filter(
      (entry): entry is { key: string; nodeType: EditDocumentNodeTypeV2 } =>
        entry.nodeType !== null && !quarantinedOwnedFields.has(entry.key),
    );
  const nodes = Object.fromEntries(
    EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => {
      const descriptor = descriptorFor(nodeType);
      const mappedParams = Object.fromEntries(
        mapped.filter((entry) => entry.nodeType === nodeType).map(({ key }) => [key, adjustments[key]]),
      );
      const params = normalizeMappedNodeParams(nodeType, descriptor?.defaultParams ?? {}, mappedParams);
      return [
        nodeType,
        {
          enabled: nodeType === 'display_creative' ? effectsEnabled : !disabledNodeTypes.has(nodeType),
          implementationVersion: descriptor?.implementationVersion ?? 1,
          params,
          process: descriptor?.process ?? 'scene_referred_v2',
          type: nodeType,
        },
      ];
    }),
  );
  const legacyAdjustments = Object.fromEntries(
    entries.filter(
      ([key]) =>
        key !== 'effectsEnabled' &&
        key !== 'rawEngineArtifacts' &&
        key !== 'sectionVisibility' &&
        nodeTypeForField(key) === null &&
        !PROVENANCE_FIELDS.has(key),
    ),
  );
  // biome-ignore lint/complexity/useLiteralKeys: legacy input intentionally uses an index signature.
  const provenance = { referenceMatchApplicationReceipt: adjustments['referenceMatchApplicationReceipt'] ?? null };
  const defaultedNodeParams = (
    [
      'camera_input',
      'black_white_mixer',
      'channel_mixer',
      'color_balance_rgb',
      'color_calibration',
      'detail_denoise_dehaze',
      'display_creative',
      'geometry',
      'lens_correction',
      'luma_levels',
      'perceptual_grading',
      'point_color',
      'scene_to_view_transform',
      'scene_curve',
      'selective_color_mixer',
      'skin_tone_uniformity',
      'source_decode',
      'tone_equalizer',
    ] as const
  ).flatMap((nodeType) => {
    const descriptor = descriptorFor(nodeType);
    return Object.keys(descriptor?.defaultParams ?? {})
      .filter((field) => !Object.hasOwn(adjustments, field) || quarantinedOwnedFields.has(field))
      .map((field) => `${nodeType}.${field}`);
  });
  // biome-ignore lint/complexity/useLiteralKeys: legacy input intentionally uses an index signature.
  const legacyCrop = adjustments['crop'];
  const defaultedCropUnit = hasRecordShape(legacyCrop) && !Object.hasOwn(legacyCrop, 'unit');
  return editDocumentV2Schema.parse({
    extensions: {
      legacyAdjustments,
      ...(layerStackArtifacts.success && layerStackArtifacts.data.rawEngineArtifacts !== undefined
        ? { rawEngineArtifacts: layerStackArtifacts.data.rawEngineArtifacts }
        : {}),
      ...(quarantinedOwnedEntries.length > 0
        ? { quarantinedLegacyAdjustments: Object.fromEntries(quarantinedOwnedEntries) }
        : {}),
      ...(hasRecordShape(adjustments['sectionVisibility'])
        ? { legacyDisclosureMetadata: { sectionVisibility: adjustments['sectionVisibility'] } }
        : {}),
    },
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    geometry: nodes['geometry']?.params ?? {},
    graphProcess: 'scene_referred_v2',
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    layers: nodes['layers']?.params ?? {},
    migration: {
      defaulted: [...defaultedNodeParams, ...(defaultedCropUnit ? ['geometry.crop.unit'] : [])].sort(),
      disabled: [...disabledNodeTypes, ...(effectsEnabled ? [] : ['display_creative' as const])].sort(),
      mapped: [
        ...mapped.map(({ key, nodeType }) => `${nodeType}.${key}`),
        ...(Object.hasOwn(adjustments, 'effectsEnabled') ||
        (hasRecordShape(adjustments['sectionVisibility']) && Object.hasOwn(adjustments['sectionVisibility'], 'effects'))
          ? ['display_creative.enabled']
          : []),
        ...(entries.some(([key]) => PROVENANCE_FIELDS.has(key)) ? ['provenance.referenceMatchApplicationReceipt'] : []),
      ].sort(),
      quarantined: [
        ...Object.keys(legacyAdjustments),
        ...quarantinedOwnedFields,
        ...(hasRecordShape(adjustments['sectionVisibility']) ? ['sectionVisibility'] : []),
      ].sort(),
      sourceSchemaVersion: 1,
    },
    nodes,
    provenance,
    schemaVersion: 2,
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    sourceDecode: nodes['source_decode']?.params ?? {},
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    sourceArtifacts: nodes['source_artifacts']?.params ?? {},
  });
};

export const editDocumentV2ToLegacyAdjustments = (document: EditDocumentV2): Adjustments => {
  const parsed = editDocumentV2Schema.parse(document);
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally quarantines future keys.
  const legacy = parsed.extensions['legacyAdjustments'];
  const nodeValues = Object.values(parsed.nodes).flatMap((node) => Object.entries(node.params));
  const projection = Object.fromEntries([
    ...Object.entries(legacy && typeof legacy === 'object' ? legacy : {}),
    ...nodeValues,
    ...(parsed.extensions['rawEngineArtifacts'] === undefined
      ? []
      : [['rawEngineArtifacts', parsed.extensions['rawEngineArtifacts']]]),
    ['effectsEnabled', parsed.nodes['display_creative']?.enabled ?? true],
    ['referenceMatchApplicationReceipt', parsed.provenance.referenceMatchApplicationReceipt],
  ]) as Adjustments;
  return projection.sceneCurveV1 !== undefined || projection.outputCurveV1 !== undefined
    ? { ...projection, rawEngineEditGraphVersion: 2 }
    : projection;
};

export const editDocumentV2NodeInventory = (document: EditDocumentV2): readonly EditDocumentNodeTypeV2[] =>
  Object.keys(document.nodes) as EditDocumentNodeTypeV2[];

export const updateEditDocumentV2Node = <NodeType extends EditDocumentNodeTypeV2>(
  document: EditDocumentV2,
  nodeType: NodeType,
  update: (params: EditDocumentNodeParamsV2<NodeType>) => EditDocumentNodeParamsV2<NodeType>,
): EditDocumentV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) return document;
  const typedParams = node.params as EditDocumentNodeParamsV2<NodeType>;
  const updatedParams = update(typedParams);
  if (updatedParams === typedParams) return document;
  if (nodeType === 'geometry') {
    const geometry = normalizeGeometryParams(updatedParams);
    const nextNode = editDocumentNodeEnvelopeV2Schema.parse({ ...node, params: geometry });
    const next: EditDocumentV2 = {
      ...document,
      geometry,
      nodes: { ...document.nodes, geometry: nextNode },
    };
    editDocumentV2Schema.parse(next);
    return next;
  }
  const normalizedParams = nodeType === 'layers' ? editDocumentLayersV2Schema.parse(updatedParams) : updatedParams;
  const nextNode = editDocumentNodeEnvelopeV2Schema.parse({ ...node, params: normalizedParams });
  const next: EditDocumentV2 = {
    ...document,
    layers: nodeType === 'layers' ? editDocumentLayersV2Schema.parse(nextNode.params) : document.layers,
    nodes: { ...document.nodes, [nodeType]: nextNode },
    sourceDecode:
      nodeType === 'source_decode' ? editDocumentSourceDecodeV2Schema.parse(nextNode.params) : document.sourceDecode,
    sourceArtifacts:
      nodeType === 'source_artifacts'
        ? editDocumentSourceArtifactsV2Schema.parse(nextNode.params)
        : document.sourceArtifacts,
  };
  editDocumentV2Schema.parse(next);
  return next;
};

/** Apply a descriptor-typed partial update while preserving unrelated node/domain identities. */
export const patchEditDocumentV2Node = <NodeType extends EditDocumentNodeTypeV2>(
  document: EditDocumentV2,
  nodeType: NodeType,
  patch: Readonly<Partial<EditDocumentNodeParamsV2<NodeType>>>,
): EditDocumentV2 => {
  const currentParams = document.nodes[nodeType]?.params;
  if (
    currentParams !== undefined &&
    Object.entries(patch).every(([key, value]) => Object.is(currentParams[key], value))
  ) {
    return document;
  }
  return updateEditDocumentV2Node(document, nodeType, (params) => {
    const updatedParams: EditDocumentNodeParamsV2<NodeType> = structuredClone(params);
    Object.assign(updatedParams, structuredClone(patch));
    return updatedParams;
  });
};

export const setEditDocumentV2NodeEnabled = (
  document: EditDocumentV2,
  nodeType: EditDocumentNodeTypeV2,
  enabled: boolean,
): EditDocumentV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined || node.enabled === enabled) return document;
  const next: EditDocumentV2 = {
    ...document,
    nodes: { ...document.nodes, [nodeType]: { ...node, enabled } },
  };
  return next;
};

/** Publish source-owned AI artifacts atomically in the node and explicit domain. */
export const replaceEditDocumentV2SourceArtifacts = (
  document: EditDocumentV2,
  sourceArtifacts: unknown,
): EditDocumentV2 => {
  const artifacts = editDocumentSourceArtifactsV2Schema.parse(sourceArtifacts);
  // biome-ignore lint/complexity/useLiteralKeys: node records intentionally use an index signature.
  const node = document.nodes['source_artifacts'];
  if (node === undefined) throw new Error('Missing source_artifacts edit node.');
  const nextNode = editDocumentNodeEnvelopeV2Schema.parse({ ...node, params: artifacts });
  const next: EditDocumentV2 = {
    ...document,
    nodes: { ...document.nodes, source_artifacts: nextNode },
    sourceArtifacts: artifacts,
  };
  editDocumentV2Schema.parse(next);
  return next;
};

export const getEditDocumentV2NodeCapabilities = (nodeType: EditDocumentNodeTypeV2) =>
  descriptorFor(nodeType)?.capabilities;

export type { EditDocumentV2CopyPayload };

export const EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES = EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.capabilities.copy && descriptor.capabilities.paste && descriptor.capabilities.provenance === 'strip'
    ? [descriptor.nodeType]
    : [],
);

export const getEditDocumentV2CopyableNodeTypes = (
  selectedNodeIds: readonly EditDocumentNodeTypeV2[] = EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES,
): readonly EditDocumentNodeTypeV2[] => {
  const selected = new Set(selectedNodeIds);
  return EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
    descriptor.capabilities.copy &&
    descriptor.capabilities.paste &&
    descriptor.capabilities.provenance === 'strip' &&
    selected.has(descriptor.nodeType)
      ? [descriptor.nodeType]
      : [],
  );
};

/** Build a provenance-free, descriptor-approved clipboard from render authority. */
export const copyEditDocumentV2Nodes = (
  document: EditDocumentV2,
  selectedNodeIds?: readonly EditDocumentNodeTypeV2[],
): EditDocumentV2CopyPayload => ({
  nodes: Object.fromEntries(
    getEditDocumentV2CopyableNodeTypes(selectedNodeIds).flatMap((nodeType) => {
      const payload = copyEditDocumentV2Node(document, nodeType);
      return payload === null ? [] : [[nodeType, payload]];
    }),
  ),
  schemaVersion: 2,
});

/** Materialize a descriptor-approved clipboard over an existing current document. */
export const applyEditDocumentV2CopyPayload = (
  document: EditDocumentV2,
  payload: EditDocumentV2CopyPayload,
): EditDocumentV2 =>
  Object.entries(payload.nodes).reduce(
    (current, [nodeType, node]) =>
      node === undefined ? current : pasteEditDocumentV2Node(current, nodeType as EditDocumentNodeTypeV2, node),
    document,
  );

export const selectEditDocumentV2CopyPayload = (
  payload: EditDocumentV2CopyPayload,
  selectedNodeIds: readonly EditDocumentNodeTypeV2[],
  skipDefaultNodes: boolean,
): EditDocumentV2CopyPayload => {
  const selected = new Set(getEditDocumentV2CopyableNodeTypes(selectedNodeIds));
  return {
    nodes: Object.fromEntries(
      Object.entries(payload.nodes).flatMap(([nodeType, node]) => {
        const descriptor = descriptorFor(nodeType as EditDocumentNodeTypeV2);
        if (
          node === undefined ||
          descriptor === undefined ||
          !selected.has(nodeType as EditDocumentNodeTypeV2) ||
          (skipDefaultNodes && node.enabled && JSON.stringify(node.params) === JSON.stringify(descriptor.defaultParams))
        ) {
          return [];
        }
        return [[nodeType, node]];
      }),
    ),
    schemaVersion: 2,
  };
};

/** Apply one focused node update across documents only when its descriptor allows batch edits. */
export const batchUpdateEditDocumentV2Nodes = <NodeType extends EditDocumentNodeTypeV2>(
  documents: readonly EditDocumentV2[],
  nodeType: NodeType,
  update: (params: EditDocumentNodeParamsV2<NodeType>, index: number) => EditDocumentNodeParamsV2<NodeType>,
): readonly EditDocumentV2[] | null => {
  const descriptor = descriptorFor(nodeType);
  if (descriptor === undefined || !descriptor.capabilities.batch) return null;
  return documents.map((document, index) =>
    updateEditDocumentV2Node(document, nodeType, (params) => update(params, index)),
  );
};

export interface EditDocumentV2NodeDiagnostic {
  readonly enabled: boolean;
  readonly implementationVersion: number;
  readonly nodeType: EditDocumentNodeTypeV2;
  readonly parameterKeys: readonly string[];
  readonly process: 'scene_referred_v2';
  readonly renderStage: string;
  readonly status: 'active' | 'disabled';
}

export interface EditDocumentV2Diagnostics {
  readonly activeNodeTypes: readonly EditDocumentNodeTypeV2[];
  readonly graphProcess: 'scene_referred_v2';
  readonly legacyNodeTypes: readonly EditDocumentNodeTypeV2[];
  readonly nodeDiagnostics: readonly EditDocumentV2NodeDiagnostic[];
  readonly quarantinedNodeTypes: readonly string[];
  readonly renderStageFingerprints: readonly {
    readonly nodeType: EditDocumentNodeTypeV2;
    readonly fingerprint: string;
  }[];
  readonly schemaVersion: number;
}

/** Build a deterministic, path-free diagnostics view from the versioned edit document. */
export const buildEditDocumentV2Diagnostics = (document: EditDocumentV2): EditDocumentV2Diagnostics => {
  const parsed = editDocumentV2Schema.parse(document);
  const activeNodeTypes = EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap(({ nodeType }) =>
    parsed.nodes[nodeType] === undefined ? [] : [nodeType],
  );
  const nodeDiagnostics = activeNodeTypes.map((nodeType) => {
    const node = parsed.nodes[nodeType];
    const descriptor = descriptorFor(nodeType);
    if (node === undefined || descriptor === undefined) throw new Error(`Missing edit node descriptor: ${nodeType}`);
    return {
      enabled: node.enabled,
      implementationVersion: node.implementationVersion,
      nodeType,
      parameterKeys: Object.keys(node.params).sort(),
      process: node.process,
      renderStage: descriptor.renderStage,
      status: node.enabled ? 'active' : 'disabled',
    } satisfies EditDocumentV2NodeDiagnostic;
  });
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally carries quarantined future nodes.
  const quarantined = parsed.extensions['quarantinedNodes'];
  const quarantinedNodeTypes =
    quarantined && typeof quarantined === 'object' && !Array.isArray(quarantined)
      ? Object.keys(quarantined).sort()
      : [];
  return {
    activeNodeTypes,
    graphProcess: parsed.graphProcess,
    legacyNodeTypes: [],
    nodeDiagnostics,
    quarantinedNodeTypes,
    renderStageFingerprints: nodeDiagnostics.map(({ nodeType }) => ({
      nodeType,
      fingerprint: JSON.stringify([nodeType, parsed.nodes[nodeType]?.params]),
    })),
    schemaVersion: parsed.schemaVersion,
  };
};

/** Reset one node using its descriptor-owned defaults without touching other domains. */
export const resetEditDocumentV2Node = (document: EditDocumentV2, nodeType: EditDocumentNodeTypeV2): EditDocumentV2 => {
  const parsed = editDocumentV2Schema.parse(document);
  const descriptor = descriptorFor(nodeType);
  const node = parsed.nodes[nodeType];
  if (descriptor === undefined || node === undefined || !descriptor.capabilities.reset) return parsed;
  const nextNode = editDocumentNodeEnvelopeV2Schema.parse({
    ...node,
    enabled: true,
    params: structuredClone(descriptor.defaultParams),
  });
  return editDocumentV2Schema.parse({
    ...parsed,
    geometry: nodeType === 'geometry' ? editDocumentGeometryV2Schema.parse(nextNode.params) : parsed.geometry,
    nodes: { ...parsed.nodes, [nodeType]: nextNode },
    sourceDecode:
      nodeType === 'source_decode' ? editDocumentSourceDecodeV2Schema.parse(nextNode.params) : parsed.sourceDecode,
  });
};

/** Copy only descriptor-approved creative node state; provenance never travels in the payload. */
export const copyEditDocumentV2Node = (
  document: EditDocumentV2,
  nodeType: EditDocumentNodeTypeV2,
): EditDocumentNodeEnvelopeV2 | null => {
  const parsed = editDocumentV2Schema.parse(document);
  const descriptor = descriptorFor(nodeType);
  const node = parsed.nodes[nodeType];
  if (descriptor === undefined || node === undefined || !descriptor.capabilities.copy) return null;
  return editDocumentNodeEnvelopeV2Schema.parse({ ...node, params: structuredClone(node.params) });
};

/** Paste a validated node payload while keeping document provenance and unrelated nodes untouched. */
export const pasteEditDocumentV2Node = (
  document: EditDocumentV2,
  nodeType: EditDocumentNodeTypeV2,
  payload: unknown,
): EditDocumentV2 => {
  editDocumentV2Schema.parse(document);
  const descriptor = descriptorFor(nodeType);
  const node = document.nodes[nodeType];
  const candidate = editDocumentNodeEnvelopeV2Schema.safeParse(payload);
  if (
    descriptor === undefined ||
    node === undefined ||
    !descriptor.capabilities.paste ||
    !candidate.success ||
    candidate.data.type !== nodeType ||
    candidate.data.process !== descriptor.process ||
    candidate.data.implementationVersion !== descriptor.implementationVersion
  ) {
    return document;
  }
  if (JSON.stringify(node) === JSON.stringify(candidate.data)) return document;
  const nextNode = { ...candidate.data, params: structuredClone(candidate.data.params) };
  const next: EditDocumentV2 = {
    ...document,
    geometry: nodeType === 'geometry' ? editDocumentGeometryV2Schema.parse(nextNode.params) : document.geometry,
    nodes: { ...document.nodes, [nodeType]: nextNode },
  };
  editDocumentV2Schema.parse(next);
  return next;
};
