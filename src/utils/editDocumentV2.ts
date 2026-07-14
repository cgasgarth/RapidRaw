import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentNodeEnvelopeV2,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  editDocumentNodeEnvelopeV2Schema,
  editDocumentV2Schema,
  getEditDocumentNodeDescriptor,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';

const descriptorFor = (nodeType: EditDocumentNodeTypeV2) => getEditDocumentNodeDescriptor(nodeType);

const nodeTypeForField = (key: string): EditDocumentNodeTypeV2 | null => {
  const descriptor = EDIT_DOCUMENT_NODE_DESCRIPTORS.find((candidate) =>
    candidate.legacyFields.some((field) => field === key),
  );
  return descriptor?.nodeType ?? null;
};

export const legacyAdjustmentsToEditDocumentV2 = (adjustments: Adjustments): EditDocumentV2 => {
  const entries = Object.entries(adjustments);
  const mapped = entries
    .map(([key]) => ({ key, nodeType: nodeTypeForField(key) }))
    .filter((entry): entry is { key: string; nodeType: EditDocumentNodeTypeV2 } => entry.nodeType !== null);
  const nodes = Object.fromEntries(
    EDIT_DOCUMENT_NODE_DESCRIPTORS.map(({ nodeType }) => {
      const descriptor = descriptorFor(nodeType);
      const params = Object.fromEntries(
        mapped
          .filter((entry) => entry.nodeType === nodeType)
          .map(({ key }) => [key, adjustments[key as keyof Adjustments]]),
      );
      return [
        nodeType,
        {
          enabled: true,
          implementationVersion: descriptor?.implementationVersion ?? 1,
          params,
          process: descriptor?.process ?? 'scene_referred_v2',
          type: nodeType,
        },
      ];
    }),
  );
  const legacyAdjustments = Object.fromEntries(entries.filter(([key]) => nodeTypeForField(key) === null));
  return editDocumentV2Schema.parse({
    extensions: { legacyAdjustments },
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    geometry: nodes['geometry']?.params ?? {},
    graphProcess: 'scene_referred_v2',
    // biome-ignore lint/complexity/useLiteralKeys: Object.fromEntries returns an index-signature map.
    layers: nodes['layers']?.params ?? {},
    migration: {
      defaulted: [],
      disabled: [],
      mapped: mapped.map(({ key, nodeType }) => `${nodeType}.${key}`).sort(),
      quarantined: Object.keys(legacyAdjustments).sort(),
      sourceSchemaVersion: 1,
    },
    nodes,
    provenance: {},
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
  const nextNode = editDocumentNodeEnvelopeV2Schema.parse({ ...node, params: update(node.params) });
  return { ...document, nodes: { ...document.nodes, [nodeType]: nextNode } };
};

export const getEditDocumentV2NodeCapabilities = (nodeType: EditDocumentNodeTypeV2) =>
  descriptorFor(nodeType)?.capabilities;

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
  const parsed = editDocumentV2Schema.parse(document);
  const descriptor = descriptorFor(nodeType);
  const node = parsed.nodes[nodeType];
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
    return parsed;
  }
  return editDocumentV2Schema.parse({
    ...parsed,
    nodes: { ...parsed.nodes, [nodeType]: { ...candidate.data, params: structuredClone(candidate.data.params) } },
  });
};
