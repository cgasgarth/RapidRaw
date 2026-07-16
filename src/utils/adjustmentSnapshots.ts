import { type EditDocumentV2, editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { Adjustments } from './adjustments';
import { editDocumentV2ToLegacyAdjustments, legacyAdjustmentsToEditDocumentV2 } from './editDocumentV2';

export interface AdjustmentSnapshot {
  readonly value: Readonly<Adjustments>;
  readonly editDocumentV2: Readonly<EditDocumentV2>;
  /** Preview-publication identity; the editor's sole edit revision lives in EditorState.adjustmentRevision. */
  readonly renderRevision: number;
  readonly geometryRevision: number;
  readonly maskRevision: number;
  readonly patchRevision: number;
}

const geometryKeys = ['aspectRatio', 'crop', 'flipHorizontal', 'flipVertical', 'orientationSteps', 'rotation'] as const;

const shouldFreezeSnapshots = (): boolean =>
  (globalThis as typeof globalThis & { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !==
  'production';

const isEditDocumentV2 = (value: EditDocumentV2 | Adjustments): value is EditDocumentV2 =>
  editDocumentV2Schema.safeParse(value).success;

const deepFreezeAdjustmentSnapshot = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (!shouldFreezeSnapshots() || value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreezeAdjustmentSnapshot(nested, seen);
  return Object.freeze(value);
};

export const publishAdjustmentSnapshot = (
  previous: AdjustmentSnapshot | null,
  documentOrLegacyProjection: EditDocumentV2 | Adjustments,
  authoritativeDocument?: EditDocumentV2,
): AdjustmentSnapshot => {
  const editDocumentV2 =
    authoritativeDocument ??
    (isEditDocumentV2(documentOrLegacyProjection)
      ? documentOrLegacyProjection
      : legacyAdjustmentsToEditDocumentV2(documentOrLegacyProjection));
  if (previous?.editDocumentV2 === editDocumentV2) return previous;
  const value = editDocumentV2ToLegacyAdjustments(editDocumentV2);
  const geometryChanged = previous === null || geometryKeys.some((key) => previous.value[key] !== value[key]);
  const maskChanged = previous === null || previous.value.masks !== value.masks;
  const patchChanged = previous === null || previous.value.aiPatches !== value.aiPatches;
  deepFreezeAdjustmentSnapshot(value);
  deepFreezeAdjustmentSnapshot(editDocumentV2);
  return Object.freeze({
    value,
    editDocumentV2,
    renderRevision: (previous?.renderRevision ?? 0) + 1,
    geometryRevision: (previous?.geometryRevision ?? 0) + Number(geometryChanged),
    maskRevision: (previous?.maskRevision ?? 0) + Number(maskChanged),
    patchRevision: (previous?.patchRevision ?? 0) + Number(patchChanged),
  });
};

export interface PatchResidencySnapshot {
  readonly sessionId: number;
  readonly revision: number;
  readonly residentIds: ReadonlySet<string>;
}

export class PatchResidencyTracker {
  private state: PatchResidencySnapshot;

  constructor(sessionId = 1) {
    this.state = { sessionId, revision: 1, residentIds: new Set() };
  }

  snapshot(): PatchResidencySnapshot {
    return this.state;
  }

  markResident(sessionId: number, ids: Iterable<string>): boolean {
    if (sessionId !== this.state.sessionId) return false;
    const next = new Set(this.state.residentIds);
    for (const id of ids) next.add(id);
    if (next.size === this.state.residentIds.size) return true;
    this.state = { ...this.state, revision: this.state.revision + 1, residentIds: next };
    return true;
  }

  remove(id: string): void {
    if (!this.state.residentIds.has(id)) return;
    const next = new Set(this.state.residentIds);
    next.delete(id);
    this.state = { ...this.state, revision: this.state.revision + 1, residentIds: next };
  }

  reset(sessionId = this.state.sessionId + 1): void {
    this.state = { sessionId, revision: this.state.revision + 1, residentIds: new Set() };
  }
}
