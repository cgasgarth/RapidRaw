import type { z } from 'zod';
import {
  EDIT_DOCUMENT_COLOR_PRESENCE_FIELDS,
  EDIT_DOCUMENT_FILM_EMULATION_FIELDS,
  EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS,
  EDIT_DOCUMENT_LUMA_LEVELS_FIELDS,
  EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS,
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  EDIT_DOCUMENT_SHARPNESS_THRESHOLD_FIELDS,
  type EditDocumentNodeEnvelopeV2,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  type EditDocumentV2CopyPayload,
  editDocumentBlackWhiteMixerV2Schema,
  editDocumentCameraInputV2Schema,
  editDocumentChannelMixerV2Schema,
  editDocumentColorBalanceRgbV2Schema,
  editDocumentColorCalibrationV2Schema,
  editDocumentColorPresenceV2Schema,
  editDocumentDetailDenoiseDehazeV2Schema,
  editDocumentDisplayCreativeV2Schema,
  editDocumentFilmEmulationV2Schema,
  editDocumentGeometryV2Schema,
  editDocumentLayersV2Schema,
  editDocumentLensCorrectionV2Schema,
  editDocumentLocalContrastV2Schema,
  editDocumentLumaLevelsV2Schema,
  editDocumentManualChromaticAberrationV2Schema,
  editDocumentNodeEnvelopeV2Schema,
  editDocumentPerceptualGradingV2Schema,
  editDocumentPerspectiveCorrectionV2Schema,
  editDocumentPointColorV2Schema,
  editDocumentSceneCurveV2Schema,
  editDocumentSelectiveColorMixerV2Schema,
  editDocumentSharpnessThresholdV2Schema,
  editDocumentSourceArtifactsV2Schema,
  editDocumentToneEqualizerV2Schema,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
  getEditDocumentNodeTypesForEditorSection,
  sceneGlobalColorToneParamsV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';

const descriptorFor = (nodeType: EditDocumentNodeTypeV2) => getEditDocumentNodeDescriptor(nodeType);
const PROVENANCE_FIELDS = new Set(['referenceMatchApplicationReceipt']);
const LOCAL_CONTRAST_FIELDS = new Set<string>(EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS);
const MANUAL_CHROMATIC_ABERRATION_FIELDS = new Set<string>(EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS);
const LUMA_LEVELS_FIELDS = new Set<string>(EDIT_DOCUMENT_LUMA_LEVELS_FIELDS);
const COLOR_PRESENCE_FIELDS = new Set<string>(EDIT_DOCUMENT_COLOR_PRESENCE_FIELDS);
const SHARPNESS_THRESHOLD_FIELDS = new Set<string>(EDIT_DOCUMENT_SHARPNESS_THRESHOLD_FIELDS);
const FILM_EMULATION_FIELDS = new Set<string>(EDIT_DOCUMENT_FILM_EMULATION_FIELDS);

const migratedOwnedFieldSchema = (key: string): z.ZodType | undefined => {
  if (COLOR_PRESENCE_FIELDS.has(key)) {
    return editDocumentColorPresenceV2Schema.shape[key as (typeof EDIT_DOCUMENT_COLOR_PRESENCE_FIELDS)[number]];
  }
  if (FILM_EMULATION_FIELDS.has(key)) return editDocumentFilmEmulationV2Schema.shape.filmEmulation;
  if (LOCAL_CONTRAST_FIELDS.has(key)) {
    return editDocumentLocalContrastV2Schema.shape[key as (typeof EDIT_DOCUMENT_LOCAL_CONTRAST_FIELDS)[number]];
  }
  if (MANUAL_CHROMATIC_ABERRATION_FIELDS.has(key)) {
    return editDocumentManualChromaticAberrationV2Schema.shape[
      key as (typeof EDIT_DOCUMENT_MANUAL_CHROMATIC_ABERRATION_FIELDS)[number]
    ];
  }
  if (key === 'colorBalanceRgb') return editDocumentColorBalanceRgbV2Schema.shape.colorBalanceRgb;
  if (LUMA_LEVELS_FIELDS.has(key)) return editDocumentLumaLevelsV2Schema.shape.levels;
  if (key === 'hsl') return editDocumentSelectiveColorMixerV2Schema.shape.hsl;
  if (key === 'selectiveColorRangeControls') {
    return editDocumentSelectiveColorMixerV2Schema.shape.selectiveColorRangeControls;
  }
  if (key === 'perspectiveCorrection') {
    return editDocumentPerspectiveCorrectionV2Schema.shape.perspectiveCorrection;
  }
  if (SHARPNESS_THRESHOLD_FIELDS.has(key)) {
    return editDocumentSharpnessThresholdV2Schema.shape.sharpnessThreshold;
  }
  return undefined;
};

const hasRecordShape = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeLegacyGeometryCrop = (crop: unknown): unknown => {
  if (!hasRecordShape(crop) || Object.hasOwn(crop, 'unit')) return crop;
  const coordinates = ['x', 'y', 'width', 'height'].map((field) => crop[field]);
  const isNormalized = coordinates.every(
    (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate <= 1,
  );
  return { ...crop, unit: isNormalized ? 'normalized' : 'px' };
};

const normalizeGeometryParams = (params: Readonly<Record<string, unknown>>) =>
  editDocumentGeometryV2Schema.parse({
    ...params,
    // biome-ignore lint/complexity/useLiteralKeys: geometry candidates intentionally use an index signature.
    crop: normalizeLegacyGeometryCrop(params['crop']),
  });

const nodeTypeForField = (key: string): EditDocumentNodeTypeV2 | null => {
  const descriptor = EDIT_DOCUMENT_NODE_DESCRIPTORS.find((candidate) =>
    candidate.legacyFields.some((field) => field === key),
  );
  return descriptor?.nodeType ?? null;
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

const normalizeLegacyLayers = (params: Readonly<Record<string, unknown>>) =>
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
  scene_curve: editDocumentSceneCurveV2Schema,
  selective_color_mixer: editDocumentSelectiveColorMixerV2Schema,
  tone_equalizer: editDocumentToneEqualizerV2Schema,
};

const normalizeMappedNodeParams = (
  nodeType: EditDocumentNodeTypeV2,
  defaults: Readonly<Record<string, unknown>>,
  mappedParams: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const candidate = { ...defaults, ...mappedParams };
  if (nodeType === 'geometry') return normalizeGeometryParams(candidate);
  if (nodeType === 'layers') return normalizeLegacyLayers({ masks: [], ...mappedParams });
  const schema = STRICT_LEGACY_NODE_PARAM_SCHEMAS[nodeType];
  if (schema === undefined) return { ...mappedParams };
  const parsed = schema.parse(candidate);
  if (!hasRecordShape(parsed)) throw new Error(`EditDocumentV2 node '${nodeType}' params must be an object.`);
  return { ...parsed };
};

export const legacyAdjustmentsToEditDocumentV2 = (adjustments: Readonly<Record<string, unknown>>): EditDocumentV2 => {
  const entries = Object.entries(adjustments);
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
      'scene_curve',
      'selective_color_mixer',
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
    sourceArtifacts: nodes['source_artifacts']?.params ?? {},
  });
};

export const editDocumentV2ToLegacyAdjustments = (document: EditDocumentV2): Adjustments => {
  const parsed = editDocumentV2Schema.parse(document);
  // biome-ignore lint/complexity/useLiteralKeys: extensions intentionally quarantines future keys.
  const legacy = parsed.extensions['legacyAdjustments'];
  const nodeValues = Object.values(parsed.nodes).flatMap((node) => Object.entries(node.params));
  return Object.fromEntries([
    ...Object.entries(legacy && typeof legacy === 'object' ? legacy : {}),
    ...nodeValues,
    ['effectsEnabled', parsed.nodes['display_creative']?.enabled ?? true],
    ['referenceMatchApplicationReceipt', parsed.provenance.referenceMatchApplicationReceipt],
  ]) as Adjustments;
};

export const editDocumentV2NodeInventory = (document: EditDocumentV2): readonly EditDocumentNodeTypeV2[] =>
  Object.keys(document.nodes) as EditDocumentNodeTypeV2[];

export const updateEditDocumentV2Node = (
  document: EditDocumentV2,
  nodeType: EditDocumentNodeTypeV2,
  update: (params: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): EditDocumentV2 => {
  const node = document.nodes[nodeType];
  if (node === undefined) return document;
  const updatedParams = update(node.params);
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
    sourceArtifacts:
      nodeType === 'source_artifacts'
        ? editDocumentSourceArtifactsV2Schema.parse(nextNode.params)
        : document.sourceArtifacts,
  };
  editDocumentV2Schema.parse(next);
  return next;
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
  return editDocumentV2Schema.parse(next);
};

/**
 * Preserve prepared legacy payload behavior (including patch residency) while
 * taking migrated node families from the authoritative editor document.
 */
export const prepareEditDocumentV2ForRender = (
  preparedAdjustments: Readonly<Record<string, unknown>>,
  authoritativeDocument: EditDocumentV2,
  authoritativeNodeTypes: readonly EditDocumentNodeTypeV2[],
): EditDocumentV2 => {
  const prepared = legacyAdjustmentsToEditDocumentV2(preparedAdjustments);
  const nodes = { ...prepared.nodes };
  let geometry = prepared.geometry;
  let layers = prepared.layers;
  let sourceArtifacts = prepared.sourceArtifacts;
  for (const nodeType of authoritativeNodeTypes) {
    const authoritativeNode = authoritativeDocument.nodes[nodeType];
    if (authoritativeNode === undefined) continue;
    nodes[nodeType] = authoritativeNode;
    if (nodeType === 'geometry') geometry = editDocumentGeometryV2Schema.parse(authoritativeNode.params);
    if (nodeType === 'layers') layers = editDocumentLayersV2Schema.parse(authoritativeNode.params);
    if (nodeType === 'source_artifacts') {
      sourceArtifacts = editDocumentSourceArtifactsV2Schema.parse(authoritativeNode.params);
    }
  }
  // Explicit domains travel with their authoritative nodes; publishing only the
  // envelope would create an ambiguous render document rejected by native code.
  const next: EditDocumentV2 = {
    ...prepared,
    geometry,
    layers,
    nodes,
    sourceArtifacts,
  };
  editDocumentV2Schema.parse(next);
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

export const EDIT_DOCUMENT_V2_COPYABLE_LEGACY_FIELDS = EDIT_DOCUMENT_NODE_DESCRIPTORS.filter(
  ({ capabilities }) => capabilities.copy && capabilities.paste && capabilities.provenance === 'strip',
).flatMap(({ legacyFields }) => [...legacyFields]);

export const EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES = EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
  descriptor.capabilities.copy && descriptor.capabilities.paste && descriptor.capabilities.provenance === 'strip'
    ? [descriptor.nodeType]
    : [],
);

export const getEditDocumentV2CopyableNodeTypes = (
  includedAdjustments: readonly string[] = EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES,
): readonly EditDocumentNodeTypeV2[] => {
  const included = new Set(includedAdjustments);
  return EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
    descriptor.capabilities.copy &&
    descriptor.capabilities.paste &&
    descriptor.capabilities.provenance === 'strip' &&
    (included.has(descriptor.nodeType) || descriptor.legacyFields.some((field) => included.has(field)))
      ? [descriptor.nodeType]
      : [],
  );
};

export const getEditDocumentV2CopyableLegacyFieldsForSelection = (selection: readonly string[]): readonly string[] => {
  const selected = new Set(getEditDocumentV2CopyableNodeTypes(selection));
  return EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
    selected.has(descriptor.nodeType) ? [...descriptor.legacyFields] : [],
  );
};

/** Build a provenance-free, descriptor-approved clipboard from render authority. */
export const copyEditDocumentV2Nodes = (
  document: EditDocumentV2,
  includedAdjustments?: readonly string[],
): EditDocumentV2CopyPayload => ({
  nodes: Object.fromEntries(
    getEditDocumentV2CopyableNodeTypes(includedAdjustments).flatMap((nodeType) => {
      const payload = copyEditDocumentV2Node(document, nodeType);
      return payload === null ? [] : [[nodeType, payload]];
    }),
  ),
  schemaVersion: 2,
});

export const selectEditDocumentV2CopyPayload = (
  payload: EditDocumentV2CopyPayload,
  includedAdjustments: readonly string[],
  skipDefaultNodes: boolean,
): EditDocumentV2CopyPayload => {
  const selected = new Set(getEditDocumentV2CopyableNodeTypes(includedAdjustments));
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

/** Legacy projection exists only for native paths that have not adopted EditDocumentV2 yet. */
export const lowerEditDocumentV2CopyPayloadToLegacyAdjustments = (
  payload: EditDocumentV2CopyPayload,
): Partial<Adjustments> => {
  const lowered: Record<string, unknown> = {};
  for (const [nodeType, node] of Object.entries(payload.nodes)) {
    if (node === undefined) continue;
    const descriptor = descriptorFor(nodeType as EditDocumentNodeTypeV2);
    if (descriptor === undefined || !descriptor.capabilities.paste) continue;
    for (const field of descriptor.legacyFields) {
      if (Object.hasOwn(node.params, field)) lowered[field] = structuredClone(node.params[field]);
    }
    if (nodeType === 'display_creative') lowered['effectsEnabled'] = node.enabled;
  }
  return lowered as Partial<Adjustments>;
};

/** Apply one focused node update across documents only when its descriptor allows batch edits. */
export const batchUpdateEditDocumentV2Nodes = (
  documents: readonly EditDocumentV2[],
  nodeType: EditDocumentNodeTypeV2,
  update: (params: Readonly<Record<string, unknown>>, index: number) => Record<string, unknown>,
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
  readonly process: 'legacy_pipeline_v1' | 'scene_referred_v2';
  readonly renderStage: string;
  readonly status: 'active' | 'disabled';
}

export interface EditDocumentV2Diagnostics {
  readonly activeNodeTypes: readonly EditDocumentNodeTypeV2[];
  readonly graphProcess: 'legacy_pipeline_v1' | 'scene_referred_v2';
  readonly legacyNodeTypes: readonly EditDocumentNodeTypeV2[];
  readonly migration: EditDocumentV2['migration'] | null;
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
    legacyNodeTypes: nodeDiagnostics
      .filter(({ process }) => process === 'legacy_pipeline_v1')
      .map(({ nodeType }) => nodeType),
    migration: parsed.migration ?? null,
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
