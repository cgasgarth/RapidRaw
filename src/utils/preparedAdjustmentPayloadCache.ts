import { type EditDocumentV2, editDocumentV2Schema } from '../../packages/rawengine-schema/src/editDocumentV2';
import type { AdjustmentSnapshot, PatchResidencySnapshot } from './adjustmentSnapshots';
import { patchEditDocumentV2Node } from './editDocumentV2';

const BACKEND_SCHEMA_VERSION = 1;

export interface PreparedPayloadCacheMetrics {
  hits: number;
  misses: number;
  preparationMs: number;
}

export interface PreparedEditDocumentPayload {
  newlySentPatchIds: ReadonlySet<string>;
  payload: EditDocumentV2;
}

const maskDataKeys = ['mask_data_base64', 'maskDataBase64'] as const;

export const prepareEditDocumentPayloadForBackend = (
  document: EditDocumentV2,
  residentIds: ReadonlySet<string>,
): PreparedEditDocumentPayload => {
  const newlySentPatchIds = new Set<string>();
  type CurrentSubMask = EditDocumentV2['layers']['masks'][number]['subMasks'][number];
  const processSubMasks = (subMasks: readonly CurrentSubMask[]): CurrentSubMask[] =>
    subMasks.map((subMask) => {
      if (subMask.parameters === undefined) return subMask;
      let parameters = subMask.parameters;
      let foundMaskData = false;
      for (const key of maskDataKeys) {
        if (parameters[key] !== undefined && parameters[key] !== null) {
          foundMaskData = true;
          if (residentIds.has(subMask.id)) parameters = { ...parameters, [key]: null };
        }
      }
      if (foundMaskData && !residentIds.has(subMask.id)) newlySentPatchIds.add(subMask.id);
      return parameters === subMask.parameters ? subMask : { ...subMask, parameters };
    });
  const masks = document.layers.masks.map((mask) => ({ ...mask, subMasks: processSubMasks(mask.subMasks) }));
  const aiPatches = document.sourceArtifacts.aiPatches.map((patch) => {
    const patchData = patch.patchData !== null && residentIds.has(patch.id) ? null : patch.patchData;
    if (patch.patchData !== null && !patch.isLoading && !residentIds.has(patch.id)) newlySentPatchIds.add(patch.id);
    return { ...patch, patchData, subMasks: processSubMasks(patch.subMasks) };
  });
  const layersPatched = patchEditDocumentV2Node(document, 'layers', { masks });
  const payload = patchEditDocumentV2Node(layersPatched, 'source_artifacts', { aiPatches });
  return {
    newlySentPatchIds,
    payload: editDocumentV2Schema.parse(payload),
  };
};

export class PreparedAdjustmentPayloadCache {
  private readonly entries = new Map<string, PreparedEditDocumentPayload>();
  private readonly snapshotIdentities = new WeakMap<AdjustmentSnapshot, number>();
  private nextSnapshotIdentity = 1;
  readonly metrics: PreparedPayloadCacheMetrics = { hits: 0, misses: 0, preparationMs: 0 };

  constructor(private readonly capacity = 8) {}

  prepare(snapshot: AdjustmentSnapshot, residency: PatchResidencySnapshot): PreparedEditDocumentPayload {
    let snapshotIdentity = this.snapshotIdentities.get(snapshot);
    if (snapshotIdentity === undefined) {
      snapshotIdentity = this.nextSnapshotIdentity;
      this.nextSnapshotIdentity += 1;
      this.snapshotIdentities.set(snapshot, snapshotIdentity);
    }
    const key = `${residency.sessionId}:${String(snapshotIdentity)}:${residency.revision}:${BACKEND_SCHEMA_VERSION}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.metrics.hits += 1;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const startedAt = globalThis.performance?.now() ?? Date.now();
    const prepared = prepareEditDocumentPayloadForBackend(snapshot.editDocumentV2, residency.residentIds);
    this.metrics.misses += 1;
    this.metrics.preparationMs += (globalThis.performance?.now() ?? Date.now()) - startedAt;
    this.entries.set(key, prepared);
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value as string);
    return prepared;
  }

  reset(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
