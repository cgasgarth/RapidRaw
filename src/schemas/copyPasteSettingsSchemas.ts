import { z } from 'zod';
import {
  type EditDocumentNodeTypeV2,
  editDocumentNodeTypeV2Schema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import { PasteMode } from '../utils/adjustments';
import { EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES } from '../utils/editDocumentV2';

const COPYABLE_NODE_IDS = new Set<EditDocumentNodeTypeV2>(EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES);

export const copyPasteSelectedNodeIdsSchema = z
  .array(editDocumentNodeTypeV2Schema)
  .refine(
    (nodeIds) => nodeIds.every((nodeId) => COPYABLE_NODE_IDS.has(nodeId)),
    'Selection contains a non-copyable node.',
  )
  .refine((nodeIds) => new Set(nodeIds).size === nodeIds.length, 'Selection contains duplicate nodes.');

export const copyPasteSettingsSchema = z
  .object({
    pasteMode: z.nativeEnum(PasteMode),
    selectedNodeIds: copyPasteSelectedNodeIdsSchema,
  })
  .strict();

export type CopyPasteSettings = z.infer<typeof copyPasteSettingsSchema>;

export const createDefaultCopyPasteSettings = (): CopyPasteSettings => ({
  pasteMode: PasteMode.Merge,
  selectedNodeIds: EDIT_DOCUMENT_V2_COPYABLE_NODE_TYPES.filter(
    (nodeId) => nodeId !== 'geometry' && nodeId !== 'lens_correction',
  ),
});

export const resolveCopyPasteSettings = (value: unknown): { settings: CopyPasteSettings; wasReset: boolean } => {
  const result = copyPasteSettingsSchema.safeParse(value);
  return result.success
    ? { settings: result.data, wasReset: false }
    : { settings: createDefaultCopyPasteSettings(), wasReset: true };
};
