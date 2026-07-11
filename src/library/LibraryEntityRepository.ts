import type { ImageFile } from '../components/ui/AppProperties';

export interface LibraryImageEntity extends Omit<ImageFile, 'tags' | 'exif'> {
  readonly entityRevision: number;
  readonly tags: readonly string[] | null;
  readonly exif: Readonly<Record<string, string>> | null;
}

export interface LibraryImagePatch {
  path: string;
  changes: Partial<Omit<ImageFile, 'path'>>;
}

export interface LibraryEntityDelta {
  collectionRevision: number;
  upserted: readonly LibraryImageEntity[];
  removedPaths: readonly string[];
  renamed: readonly { oldPath: string; newPath: string }[];
}

type Listener = () => void;
type DeltaListener = (delta: LibraryEntityDelta) => void;

const freezeEntity = (image: ImageSnapshot, entityRevision: number): LibraryImageEntity => {
  const tags = image.tags ? Object.freeze([...image.tags]) : null;
  const exif = image.exif ? Object.freeze({ ...image.exif }) : null;
  return Object.freeze({ ...image, rating: Math.max(0, Math.min(5, image.rating || 0)), tags, exif, entityRevision });
};

type ImageSnapshot = Omit<ImageFile, 'tags' | 'exif'> & {
  readonly tags: readonly string[] | null;
  readonly exif: Readonly<Record<string, string>> | null;
};

const imageEqual = (left: ImageSnapshot, right: ImageSnapshot): boolean => {
  if (
    left.path !== right.path ||
    left.modified !== right.modified ||
    left.is_edited !== right.is_edited ||
    left.is_virtual_copy !== right.is_virtual_copy ||
    left.rating !== right.rating
  )
    return false;
  if (JSON.stringify(left.tags) !== JSON.stringify(right.tags)) return false;
  return JSON.stringify(left.exif) === JSON.stringify(right.exif);
};

export class LibraryEntityRepository {
  readonly #entities = new Map<string, LibraryImageEntity>();
  readonly #listeners = new Map<string, Set<Listener>>();
  readonly #deltaListeners = new Set<DeltaListener>();
  #collectionRevision = 0;

  get(path: string): LibraryImageEntity | undefined {
    return this.#entities.get(path);
  }

  getSnapshot = (path: string): LibraryImageEntity | undefined => this.#entities.get(path);

  getMany(paths: readonly string[]): LibraryImageEntity[] {
    const result: LibraryImageEntity[] = [];
    for (const path of paths) {
      const image = this.#entities.get(path);
      if (image) result.push(image);
    }
    return result;
  }

  subscribe(path: string, listener: Listener): () => void {
    let listeners = this.#listeners.get(path);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(path, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.#listeners.delete(path);
    };
  }

  subscribeDeltas(listener: DeltaListener): () => void {
    this.#deltaListeners.add(listener);
    return () => this.#deltaListeners.delete(listener);
  }

  replaceAll(images: readonly ImageFile[], ratings?: Readonly<Record<string, number>>): void {
    const nextPaths = new Set(images.map((image) => image.path));
    const removed = [...this.#entities.keys()].filter((path) => !nextPaths.has(path));
    const upserted: LibraryImageEntity[] = [];
    for (const image of images) {
      const merged = ratings ? { ...image, rating: ratings[image.path] ?? image.rating } : image;
      const current = this.#entities.get(image.path);
      if (current && imageEqual(current, merged)) continue;
      const next = freezeEntity(merged, (current?.entityRevision ?? 0) + 1);
      this.#entities.set(image.path, next);
      upserted.push(next);
    }
    for (const path of removed) this.#entities.delete(path);
    this.#emit(upserted, removed, []);
  }

  upsertMany(images: readonly ImageFile[]): void {
    const upserted: LibraryImageEntity[] = [];
    for (const image of images) {
      const current = this.#entities.get(image.path);
      if (current && imageEqual(current, image)) continue;
      const next = freezeEntity(image, (current?.entityRevision ?? 0) + 1);
      this.#entities.set(image.path, next);
      upserted.push(next);
    }
    this.#emit(upserted, [], []);
  }

  patchMany(patches: readonly LibraryImagePatch[]): void {
    const merged = new Map<string, LibraryImagePatch['changes']>();
    for (const patch of patches) merged.set(patch.path, { ...merged.get(patch.path), ...patch.changes });
    const upserted: LibraryImageEntity[] = [];
    for (const [path, changes] of merged) {
      const current = this.#entities.get(path);
      if (!current) continue;
      const candidate = { ...current, ...changes, path, rating: changes.rating ?? current.rating };
      if (imageEqual(current, candidate)) continue;
      const next = freezeEntity(candidate, current.entityRevision + 1);
      this.#entities.set(path, next);
      upserted.push(next);
    }
    this.#emit(upserted, [], []);
  }

  removeMany(paths: readonly string[]): void {
    const removed = [...new Set(paths)].filter((path) => this.#entities.delete(path));
    this.#emit([], removed, []);
  }

  rename(oldPath: string, nextImage: ImageFile): void {
    const current = this.#entities.get(oldPath);
    if (!current) return;
    this.#entities.delete(oldPath);
    const existing = this.#entities.get(nextImage.path);
    const next = freezeEntity(nextImage, Math.max(current.entityRevision, existing?.entityRevision ?? 0) + 1);
    this.#entities.set(next.path, next);
    this.#emit([next], [oldPath], [{ oldPath, newPath: next.path }]);
  }

  #emit(
    upserted: readonly LibraryImageEntity[],
    removedPaths: readonly string[],
    renamed: readonly { oldPath: string; newPath: string }[],
  ): void {
    if (upserted.length === 0 && removedPaths.length === 0) return;
    this.#collectionRevision++;
    const changed = new Set([...upserted.map((image) => image.path), ...removedPaths]);
    for (const path of changed) for (const listener of this.#listeners.get(path) ?? []) listener();
    const delta = Object.freeze({
      collectionRevision: this.#collectionRevision,
      upserted: Object.freeze([...upserted]),
      removedPaths: Object.freeze([...removedPaths]),
      renamed: Object.freeze([...renamed]),
    });
    for (const listener of this.#deltaListeners) listener(delta);
  }
}

export const libraryEntityRepository = new LibraryEntityRepository();
