import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
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
