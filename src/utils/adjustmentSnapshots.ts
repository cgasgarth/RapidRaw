import type { Adjustments } from './adjustments';

export interface AdjustmentSnapshot {
  readonly value: Readonly<Adjustments>;
  readonly adjustmentRevision: number;
  readonly geometryRevision: number;
  readonly maskRevision: number;
  readonly patchRevision: number;
}

const geometryKeys = ['crop', 'flipHorizontal', 'flipVertical', 'orientationSteps', 'rotation'] as const;

const shouldFreezeSnapshots = (): boolean =>
  (globalThis as typeof globalThis & { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV !==
  'production';

export const deepFreezeAdjustmentSnapshot = <T>(value: T, seen = new WeakSet<object>()): T => {
  if (!shouldFreezeSnapshots() || value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreezeAdjustmentSnapshot(nested, seen);
  return Object.freeze(value);
};

export const publishAdjustmentSnapshot = (
  previous: AdjustmentSnapshot | null,
  value: Adjustments,
): AdjustmentSnapshot => {
  if (previous?.value === value) return previous;
  const geometryChanged = previous === null || geometryKeys.some((key) => previous.value[key] !== value[key]);
  const maskChanged = previous === null || previous.value.masks !== value.masks;
  const patchChanged = previous === null || previous.value.aiPatches !== value.aiPatches;
  deepFreezeAdjustmentSnapshot(value);
  return Object.freeze({
    value,
    adjustmentRevision: (previous?.adjustmentRevision ?? 0) + 1,
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
