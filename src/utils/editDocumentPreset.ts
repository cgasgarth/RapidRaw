import { z } from 'zod';
import {
  EDIT_DOCUMENT_NODE_DESCRIPTORS,
  type EditDocumentNodeTypeV2,
  type EditDocumentV2,
  type EditDocumentV2CopyPayload,
  editDocumentV2CopyPayloadSchema,
} from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Preset } from '../components/ui/AppProperties';
import { type Adjustments, bindTypedCurveGraphVersion, INITIAL_ADJUSTMENTS } from './adjustments';
import {
  copyEditDocumentV2Nodes,
  legacyAdjustmentsToEditDocumentV2,
  lowerEditDocumentV2CopyPayloadToLegacyAdjustments,
  pasteEditDocumentV2Node,
  selectEditDocumentV2CopyPayload,
} from './editDocumentV2';
import type { EditTransactionRequest } from './editTransaction';

const presetNodeTypes = (includeCropTransform: boolean): readonly EditDocumentNodeTypeV2[] =>
  EDIT_DOCUMENT_NODE_DESCRIPTORS.flatMap((descriptor) =>
    descriptor.capabilities.preset === 'creative' ||
    (includeCropTransform && descriptor.capabilities.preset === 'optional_geometry')
      ? [descriptor.nodeType]
      : [],
  );

export const createEditDocumentPresetPayload = (
  document: EditDocumentV2,
  includeCropTransform: boolean,
  presetType: 'style' | 'tool',
): EditDocumentV2CopyPayload =>
  selectEditDocumentV2CopyPayload(
    copyEditDocumentV2Nodes(document, presetNodeTypes(includeCropTransform)),
    presetNodeTypes(includeCropTransform),
    presetType === 'tool',
  );

export const RAPIDRAW_PRESET_FORMAT = 'rapidraw.preset' as const;
export const RAPIDRAW_PRESET_SCHEMA_VERSION = 1 as const;

const sanitizePresetPayload = (
  value: unknown,
  destination: EditDocumentV2,
  includeCropTransform: boolean,
): EditDocumentV2CopyPayload | null => {
  const parsed = editDocumentV2CopyPayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  const allowed = new Set(presetNodeTypes(includeCropTransform));
  const nodes: EditDocumentV2CopyPayload['nodes'] = {};
  for (const [nodeType, node] of Object.entries(parsed.data.nodes)) {
    if (node === undefined || !allowed.has(nodeType as EditDocumentNodeTypeV2)) continue;
    try {
      const next = pasteEditDocumentV2Node(destination, nodeType as EditDocumentNodeTypeV2, node);
      if (
        next !== destination ||
        JSON.stringify(destination.nodes[nodeType as EditDocumentNodeTypeV2]) === JSON.stringify(node)
      ) {
        nodes[nodeType as EditDocumentNodeTypeV2] = structuredClone(node);
      }
    } catch {
      // Malformed imported nodes are rejected independently instead of poisoning the preset library.
    }
  }
  return Object.keys(nodes).length === 0 ? null : { nodes, schemaVersion: 2 };
};

/** Resolve the only supported RapidRaw preset authority. Invalid payloads fail closed. */
export const resolveEditDocumentPresetPayload = (
  preset: Pick<Preset, 'editDocumentV2' | 'includeCropTransform'>,
  destination: EditDocumentV2,
): EditDocumentV2CopyPayload | null =>
  sanitizePresetPayload(preset.editDocumentV2, destination, preset.includeCropTransform);

export const configureEditDocumentPresetPayload = (
  preset: Pick<Preset, 'editDocumentV2' | 'includeCropTransform'>,
  includeCropTransform: boolean,
  presetType: 'style' | 'tool',
): EditDocumentV2CopyPayload | null => {
  const defaults = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
  const existing = resolveEditDocumentPresetPayload(preset, defaults);
  if (existing === null) return null;
  const complete = createEditDocumentPresetPayload(defaults, includeCropTransform, 'style');
  const merged: EditDocumentV2CopyPayload = {
    nodes: { ...complete.nodes, ...(existing?.nodes ?? {}) },
    schemaVersion: 2,
  };
  return selectEditDocumentV2CopyPayload(merged, presetNodeTypes(includeCropTransform), presetType === 'tool');
};

const colorStyleProvenanceSchema = z
  .object({
    createdAt: z.string(),
    legalNamingStatus: z.literal('user_named'),
    legalWarning: z.string(),
    source: z.literal('user_created'),
    updatedAt: z.string(),
  })
  .strict();
const persistedPresetSchema = z
  .object({
    colorStyleProvenance: colorStyleProvenanceSchema.optional(),
    editDocumentV2: editDocumentV2CopyPayloadSchema,
    format: z.literal(RAPIDRAW_PRESET_FORMAT),
    id: z.string().min(1),
    includeCropTransform: z.boolean(),
    includeMasks: z.literal(false),
    name: z.string().min(1),
    presetType: z.enum(['style', 'tool']),
    schemaVersion: z.literal(RAPIDRAW_PRESET_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((preset, context) => {
    const allowed = new Set(presetNodeTypes(preset.includeCropTransform));
    const nodeTypes = Object.keys(preset.editDocumentV2.nodes) as EditDocumentNodeTypeV2[];
    if (nodeTypes.length === 0) {
      context.addIssue({ code: 'custom', message: 'RapidRaw presets require at least one current node.' });
    }
    for (const nodeType of nodeTypes) {
      if (!allowed.has(nodeType)) {
        context.addIssue({
          code: 'custom',
          message: `RapidRaw preset node '${nodeType}' is not allowed by preset policy.`,
          path: ['editDocumentV2', 'nodes', nodeType],
        });
      }
    }
    if (preset.colorStyleProvenance !== undefined && preset.presetType !== 'style') {
      context.addIssue({ code: 'custom', message: 'Only style presets can contain color-style provenance.' });
    }
  });
const presetItemSchema = z.object({ preset: persistedPresetSchema }).strict();
const folderHeaderSchema = z
  .object({
    children: z.array(z.unknown()),
    id: z.string().min(1),
    name: z.string().min(1),
  })
  .strict();
const folderItemSchema = z.object({ folder: folderHeaderSchema }).strict();

export interface ParsedPresetLibraryItem {
  folder?: { children: Preset[]; id: string; name: string };
  preset?: Preset;
}

export interface ParsedPresetLibrary {
  items: ParsedPresetLibraryItem[];
  quarantinedCount: number;
}

export interface ExternalPresetImportDiagnostic {
  code: 'invalid_external_value' | 'unsupported_external_field';
  field: string;
  message: string;
}

const externalPresetImportResultSchema = z
  .object({
    diagnostics: z.array(
      z
        .object({
          code: z.enum(['invalid_external_value', 'unsupported_external_field']),
          field: z.string().min(1),
          message: z.string().min(1),
        })
        .strict(),
    ),
    presets: z.unknown(),
  })
  .strict();

/** Runtime boundary for native and imported preset libraries; invalid entries are quarantined, never promoted. */
export const parsePresetLibrary = (value: unknown): ParsedPresetLibrary => {
  const topLevel = z.array(z.unknown()).safeParse(value);
  if (!topLevel.success) return { items: [], quarantinedCount: 1 };
  const items: ParsedPresetLibraryItem[] = [];
  let quarantinedCount = 0;
  for (const candidate of topLevel.data) {
    const presetItem = presetItemSchema.safeParse(candidate);
    if (presetItem.success) {
      items.push({ preset: presetItem.data.preset });
      continue;
    }
    const folderItem = folderItemSchema.safeParse(candidate);
    if (!folderItem.success) {
      quarantinedCount += 1;
      continue;
    }
    const children: Preset[] = [];
    for (const child of folderItem.data.folder.children) {
      const parsedChild = persistedPresetSchema.safeParse(child);
      if (parsedChild.success) children.push(parsedChild.data);
      else quarantinedCount += 1;
    }
    items.push({
      folder: {
        children,
        id: folderItem.data.folder.id,
        name: folderItem.data.folder.name,
      },
    });
  }
  return { items, quarantinedCount };
};

export const parseExternalPresetImportResult = (
  value: unknown,
): { diagnostics: ExternalPresetImportDiagnostic[]; library: ParsedPresetLibrary } => {
  const result = externalPresetImportResultSchema.parse(value);
  return { diagnostics: result.diagnostics, library: parsePresetLibrary(result.presets) };
};

/** Compile current preset authority for the native renderer's adjustment request contract. */
export const buildPresetPreviewAdjustments = (
  preset: Pick<Preset, 'editDocumentV2' | 'includeCropTransform'>,
): Adjustments | null => {
  const defaults = legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS);
  const payload = resolveEditDocumentPresetPayload(preset, defaults);
  return payload === null
    ? null
    : {
        ...structuredClone(INITIAL_ADJUSTMENTS),
        ...bindTypedCurveGraphVersion(lowerEditDocumentV2CopyPayloadToLegacyAdjustments(payload)),
      };
};

export interface PresetEditTransactionState {
  adjustmentRevision: number;
  editDocumentV2: EditDocumentV2;
  imageSession: { id: string } | null;
  imageSessionId: number;
}

export const buildPresetEditTransaction = (
  state: PresetEditTransactionState,
  payload: EditDocumentV2CopyPayload,
  transactionId: string,
): EditTransactionRequest | null => {
  const operations = Object.entries(payload.nodes).flatMap(([nodeType, node]) =>
    node === undefined
      ? []
      : [
          {
            node: structuredClone(node),
            nodeType: nodeType as EditDocumentNodeTypeV2,
            type: 'replace-edit-document-node' as const,
          },
        ],
  );
  if (operations.length === 0) return null;
  return {
    baseAdjustmentRevision: state.adjustmentRevision,
    history: 'single-entry',
    imageSessionId: state.imageSession?.id ?? `editor-image-session:${String(state.imageSessionId)}`,
    operations,
    persistence: 'commit',
    source: 'preset',
    transactionId,
  };
};
