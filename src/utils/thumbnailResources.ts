import { invoke } from '@tauri-apps/api/core';
import { Invokes } from '../tauri/commands';

export type ThumbnailResourceKind = 'thumbnail' | 'smartPreview';

export interface ThumbnailResourceDescriptor {
  byteLen: number;
  generation: number;
  height: number;
  mimeType: 'image/jpeg';
  resourceId: string;
  revision: string;
  source: 'diskCache' | 'generated' | 'smartPreview';
  width: number;
}

interface CachedResource {
  descriptor: ThumbnailResourceDescriptor;
  objectUrl?: string;
  url: string;
}

const protocolPath = (descriptor: ThumbnailResourceDescriptor, kind: ThumbnailResourceKind): string => {
  const segment = kind === 'thumbnail' ? 'thumbnail' : 'smart-preview';
  const authority = /Windows|Android/i.test(navigator.userAgent)
    ? 'http://rapidraw-thumb.localhost'
    : 'rapidraw-thumb://localhost';
  return `${authority}/${segment}/${descriptor.resourceId}?v=${descriptor.revision}`;
};

export class ThumbnailResourceCache {
  private readonly entries = new Map<string, CachedResource>();

  setProtocol(
    path: string,
    descriptor: ThumbnailResourceDescriptor,
    kind: ThumbnailResourceKind = 'thumbnail',
  ): string {
    const current = this.entries.get(path);
    if (current && current.descriptor.generation > descriptor.generation) return current.url;
    if (current?.descriptor.revision === descriptor.revision) return current.url;
    this.revoke(current);
    const url = protocolPath(descriptor, kind);
    this.entries.set(path, { descriptor, url });
    return url;
  }

  async setBinaryFallback(
    path: string,
    descriptor: ThumbnailResourceDescriptor,
    kind: ThumbnailResourceKind = 'thumbnail',
  ): Promise<string> {
    const current = this.entries.get(path);
    if (current && current.descriptor.generation > descriptor.generation) return current.url;
    if (current?.objectUrl && current.descriptor.revision === descriptor.revision) return current.url;
    const bytes = await invoke<ArrayBuffer>(Invokes.GetThumbnailResource, {
      kind,
      resourceId: descriptor.resourceId,
      revision: descriptor.revision,
    });
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: descriptor.mimeType }));
    this.revoke(current);
    this.entries.set(path, { descriptor, objectUrl, url: objectUrl });
    return objectUrl;
  }

  delete(path: string): void {
    this.revoke(this.entries.get(path));
    this.entries.delete(path);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.revoke(entry);
    this.entries.clear();
  }

  private revoke(entry: CachedResource | undefined): void {
    if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
}

export const thumbnailResourceCache = new ThumbnailResourceCache();
