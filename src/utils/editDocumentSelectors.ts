import { z } from 'zod';
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
import type { AiPatch, MaskContainer } from './adjustments';

const editorMaskContainersSchema = z.custom<readonly MaskContainer[]>((value) => {
  if (!Array.isArray(value)) return false;
  return value.every(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof (candidate as { id?: unknown }).id === 'string' &&
      Array.isArray((candidate as { subMasks?: unknown }).subMasks),
  );
}, 'Invalid editor mask container collection');

const editorAiPatchesSchema = z.custom<readonly AiPatch[]>((value) => {
  if (!Array.isArray(value)) return false;
  return value.every(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      typeof (candidate as { id?: unknown }).id === 'string' &&
      Array.isArray((candidate as { subMasks?: unknown }).subMasks),
  );
}, 'Invalid editor AI patch collection');

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

/** Select the editor's typed layer domain after canonical EditDocumentV2 validation. */
export const selectEditDocumentMasks = (document: EditDocumentV2): readonly MaskContainer[] =>
  editorMaskContainersSchema.parse(document.layers.masks);

export const selectEditDocumentSourceArtifacts = (document: EditDocumentV2): Readonly<EditDocumentSourceArtifactsV2> =>
  document.sourceArtifacts;

export const selectEditDocumentAiPatches = (document: EditDocumentV2): readonly AiPatch[] =>
  editorAiPatchesSchema.parse(document.sourceArtifacts.aiPatches);

export const selectEditDocumentSourceDecode = (document: EditDocumentV2): Readonly<EditDocumentSourceDecodeV2> =>
  document.sourceDecode;

/** Resolve one named control directly from its typed owner without constructing a flat adjustment document. */
export const selectEditDocumentControlValue = (document: EditDocumentV2, key: string): unknown => {
  const geometryValue = Object.entries(document.geometry).find(([field]) => field === key);
  if (geometryValue !== undefined) return geometryValue[1];
  const sourceDecodeValue = Object.entries(document.sourceDecode).find(([field]) => field === key);
  if (sourceDecodeValue !== undefined) return sourceDecodeValue[1];
  for (const node of Object.values(document.nodes)) {
    if (node !== undefined && Object.hasOwn(node.params, key)) return node.params[key];
  }
  return undefined;
};
