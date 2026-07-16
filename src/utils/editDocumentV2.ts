import {
  currentRenderEditDocumentV2Schema,
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
    extensions: {},
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

/** Seal current typed authority before crossing the native persistence boundary. */
export const prepareEditDocumentV2ForPersistence = (document: EditDocumentV2): EditDocumentV2 => {
  const quarantinedNodes = document.extensions['quarantinedNodes'];
  const current = currentRenderEditDocumentV2Schema.parse({
    ...document,
    extensions: quarantinedNodes === undefined ? {} : { quarantinedNodes },
  });
  const jsonSafe: unknown = JSON.parse(JSON.stringify(current));
  return currentRenderEditDocumentV2Schema.parse(jsonSafe);
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
