import { z } from 'zod';
import { type EditDocumentV2, editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';

/** The extension is persisted with the current typed edit document. */
export const EDITOR_NAMED_SNAPSHOTS_EXTENSION_KEY = 'rawengineNamedSnapshots';
const EDITOR_NAMED_SNAPSHOTS_VERSION = 1;

const namedSnapshotSchema = z
  .object({
    createdAt: z.string().datetime({ offset: true }),
    editDocumentV2: editDocumentV2Schema,
    id: z.string().min(1),
    label: z.string().trim().min(1),
    sourceImagePath: z.string().min(1),
    sourceSessionId: z.string().min(1),
  })
  .strict();

const namedSnapshotsEnvelopeSchema = z
  .object({
    snapshots: z.array(namedSnapshotSchema).max(128),
    version: z.literal(EDITOR_NAMED_SNAPSHOTS_VERSION),
  })
  .strict();

export type EditorNamedSnapshot = z.infer<typeof namedSnapshotSchema>;
export type EditorNamedSnapshotsEnvelope = z.infer<typeof namedSnapshotsEnvelopeSchema>;

const emptyEnvelope = (): EditorNamedSnapshotsEnvelope => ({
  snapshots: [],
  version: EDITOR_NAMED_SNAPSHOTS_VERSION,
});

export const stripNamedSnapshots = (document: EditDocumentV2): EditDocumentV2 => {
  const { [EDITOR_NAMED_SNAPSHOTS_EXTENSION_KEY]: _snapshots, ...extensions } = document.extensions;
  return { ...document, extensions };
};

export const readNamedSnapshotsEnvelope = (document: EditDocumentV2): EditorNamedSnapshotsEnvelope => {
  const parsed = namedSnapshotsEnvelopeSchema.safeParse(document.extensions[EDITOR_NAMED_SNAPSHOTS_EXTENSION_KEY]);
  return parsed.success ? parsed.data : emptyEnvelope();
};

export const readNamedSnapshots = (
  document: EditDocumentV2,
  sourceImagePath: string | null,
  sourceSessionId: string,
): readonly EditorNamedSnapshot[] => {
  if (!sourceImagePath) return [];
  return readNamedSnapshotsEnvelope(document).snapshots.filter(
    (snapshot) => snapshot.sourceImagePath === sourceImagePath && snapshot.sourceSessionId === sourceSessionId,
  );
};

export const withNamedSnapshots = (
  document: EditDocumentV2,
  snapshots: readonly EditorNamedSnapshot[],
): EditDocumentV2 => ({
  ...document,
  extensions: {
    ...document.extensions,
    [EDITOR_NAMED_SNAPSHOTS_EXTENSION_KEY]: namedSnapshotsEnvelopeSchema.parse({
      snapshots,
      version: EDITOR_NAMED_SNAPSHOTS_VERSION,
    }),
  },
});

export const snapshotDocumentEquals = (left: EditDocumentV2, right: EditDocumentV2): boolean =>
  JSON.stringify(stripNamedSnapshots(left)) === JSON.stringify(stripNamedSnapshots(right));

export const normalizeSnapshotLabel = (label: string): string => label.trim();

export const hasDuplicateSnapshotLabel = (
  snapshots: readonly EditorNamedSnapshot[],
  label: string,
  excludeId?: string,
): boolean => {
  const normalized = normalizeSnapshotLabel(label).toLocaleLowerCase();
  return snapshots.some(
    (snapshot) => snapshot.id !== excludeId && snapshot.label.trim().toLocaleLowerCase() === normalized,
  );
};
