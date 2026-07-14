import type { FilmRenderResultIdentityV1 } from '../../../packages/rawengine-schema/src/index.js';
import { buildFilmCacheKeys } from './filmRenderScheduler';

export type FilmThumbnailRecord = {
  key: string;
  payloadHash: string;
  width: number;
  height: number;
  rendererVersion: string;
  outputIdentity: string;
  payload: string;
  pinned: boolean;
};

export class FilmThumbnailCache {
  private readonly entries = new Map<string, FilmThumbnailRecord>();

  constructor(private readonly capacity = 24) {}

  keyFor(identity: FilmRenderResultIdentityV1): string {
    return buildFilmCacheKeys({ ...identity, quality: 'profile_thumbnail_v1' }).thumbnailKey;
  }

  get(key: string, rendererVersion: string): FilmThumbnailRecord | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.rendererVersion !== rendererVersion || entry.key !== key) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  put(entry: FilmThumbnailRecord): void {
    if (entry.width <= 0 || entry.height <= 0 || entry.payload.length === 0) return;
    this.entries.delete(entry.key);
    this.entries.set(entry.key, entry);
    while (this.entries.size > this.capacity) {
      const evictable = [...this.entries.values()].find((candidate) => !candidate.pinned);
      if (evictable === undefined) break;
      this.entries.delete(evictable.key);
    }
  }

  clearUnpinned(): void {
    for (const [key, entry] of this.entries) if (!entry.pinned) this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}
