import {
  type PreparedAdjustmentPayload,
  prepareAdjustmentPayloadForBackend,
} from '../schemas/adjustmentPayloadSchemas';
import type { AdjustmentSnapshot, PatchResidencySnapshot } from './adjustmentSnapshots';

const BACKEND_SCHEMA_VERSION = 1;

export interface PreparedPayloadCacheMetrics {
  hits: number;
  misses: number;
  preparationMs: number;
}

export class PreparedAdjustmentPayloadCache {
  private readonly entries = new Map<string, PreparedAdjustmentPayload>();
  readonly metrics: PreparedPayloadCacheMetrics = { hits: 0, misses: 0, preparationMs: 0 };

  constructor(private readonly capacity = 8) {}

  prepare(snapshot: AdjustmentSnapshot, residency: PatchResidencySnapshot): PreparedAdjustmentPayload {
    const key = `${residency.sessionId}:${snapshot.adjustmentRevision}:${residency.revision}:${BACKEND_SCHEMA_VERSION}`;
    const cached = this.entries.get(key);
    if (cached) {
      this.metrics.hits += 1;
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const startedAt = globalThis.performance?.now() ?? Date.now();
    const prepared = prepareAdjustmentPayloadForBackend(snapshot.value, residency.residentIds);
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
