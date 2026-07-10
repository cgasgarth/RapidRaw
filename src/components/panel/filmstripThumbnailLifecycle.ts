export const FILMSTRIP_THUMBNAIL_DECODE_TIMEOUT_MS = 3_000;
export const FILMSTRIP_THUMBNAIL_HANDOFF_DURATION_MS = 150;

interface DecodedThumbnailRevision {
  path: string;
  url: string;
}

export class DecodedThumbnailReadinessCache {
  private entries: DecodedThumbnailRevision[] = [];

  constructor(private readonly capacity: number) {}

  has(path: string, url: string): boolean {
    const index = this.entries.findIndex((entry) => entry.path === path && entry.url === url);
    if (index < 0) return false;

    const entry = this.entries[index];
    if (entry === undefined) return false;

    this.entries.splice(index, 1);
    this.entries.push(entry);
    return true;
  }

  markDecoded(path: string, url: string) {
    if (this.has(path, url)) return;

    this.entries.push({ path, url });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }
}

export const filmstripThumbnailReadiness = new DecodedThumbnailReadinessCache(48);
