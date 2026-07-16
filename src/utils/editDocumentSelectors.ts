import type {
  EditDocumentGeometryV2,
  EditDocumentLayersV2,
  EditDocumentNodeEnvelopeV2,
  EditDocumentNodeParamsV2,
  EditDocumentNodeTypeV2,
  EditDocumentSourceArtifactsV2,
  EditDocumentSourceDecodeV2,
  EditDocumentV2,
} from '../../packages/rawengine-schema/src/editDocumentV2';

export type TypedEditDocumentNodeV2<NodeType extends EditDocumentNodeTypeV2> = Omit<
  EditDocumentNodeEnvelopeV2,
  'params' | 'type'
> & {
  readonly params: Readonly<EditDocumentNodeParamsV2<NodeType>>;
  readonly type: NodeType;
};

/** Select one descriptor-owned node. Unrelated document edits preserve this envelope's identity. */
export const selectEditDocumentNode = <NodeType extends EditDocumentNodeTypeV2>(
  document: EditDocumentV2,
  nodeType: NodeType,
): TypedEditDocumentNodeV2<NodeType> => {
  const node = document.nodes[nodeType];
  if (node === undefined) throw new Error(`edit_document_selector.missing_node:${nodeType}`);
  return node as TypedEditDocumentNodeV2<NodeType>;
};

export const selectEditDocumentGeometry = (document: EditDocumentV2): Readonly<EditDocumentGeometryV2> =>
  document.geometry;

export const selectEditDocumentLayers = (document: EditDocumentV2): Readonly<EditDocumentLayersV2> => document.layers;

export const selectEditDocumentSourceArtifacts = (document: EditDocumentV2): Readonly<EditDocumentSourceArtifactsV2> =>
  document.sourceArtifacts;

export const selectEditDocumentSourceDecode = (document: EditDocumentV2): Readonly<EditDocumentSourceDecodeV2> =>
  document.sourceDecode;
