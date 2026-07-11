import type { ImageFile } from '../components/ui/AppProperties';
import {
  buildLibrarySearchProjection,
  type LibrarySearchProjection,
  type NormalizedSupportedTypes,
} from './LibrarySearchProjection';

interface ProjectionInputs {
  aperture: string | undefined;
  cameraMake: string | undefined;
  cameraModel: string | undefined;
  dateTaken: string | undefined;
  exposureTime: string | undefined;
  focalLength: string | undefined;
  iso: string | undefined;
  isoFallback: string | undefined;
  isEdited: boolean;
  lens: string | undefined;
  lensMake: string | undefined;
  lensModel: string | undefined;
  modified: number;
  path: string;
  rating: number;
  supportedTypes: NormalizedSupportedTypes;
  tags: readonly string[];
}

interface CacheEntry {
  inputs: ProjectionInputs;
  projection: LibrarySearchProjection;
}

export class LibraryProjectionCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #ordinals = new Map<string, number>();
  #nextOrdinal = 0;
  #revision = 0;
  #buildCount = 0;

  get buildCount(): number {
    return this.#buildCount;
  }

  get size(): number {
    return this.#entries.size;
  }

  getOrBuild(image: ImageFile, rating: number, supportedTypes: NormalizedSupportedTypes): LibrarySearchProjection {
    const inputs = projectionInputs(image, rating, supportedTypes);
    const cached = this.#entries.get(image.path);
    if (cached && inputsEqual(cached.inputs, inputs)) return cached.projection;

    let stableOrdinal = this.#ordinals.get(image.path);
    if (stableOrdinal === undefined) {
      stableOrdinal = this.#nextOrdinal++;
      this.#ordinals.set(image.path, stableOrdinal);
    }
    const projection = buildLibrarySearchProjection(image, {
      entityRevision: ++this.#revision,
      rating,
      stableOrdinal,
      supportedTypes,
    });
    this.#entries.set(image.path, { inputs, projection });
    this.#buildCount++;
    return projection;
  }

  remove(path: string): void {
    this.#entries.delete(path);
    this.#ordinals.delete(path);
  }

  retainOnly(paths: ReadonlySet<string>): void {
    for (const path of this.#entries.keys()) {
      if (!paths.has(path)) this.remove(path);
    }
  }

  clearForSupportedTypesChange(): void {
    this.#entries.clear();
  }
}

function projectionInputs(
  image: ImageFile,
  rating: number,
  supportedTypes: NormalizedSupportedTypes,
): ProjectionInputs {
  const exif = image.exif;
  return {
    path: image.path,
    modified: image.modified,
    isEdited: image.is_edited,
    tags: image.tags ? [...image.tags] : [],
    rating,
    supportedTypes,
    iso: exif?.['PhotographicSensitivity'],
    isoFallback: exif?.['ISOSpeedRatings'],
    exposureTime: exif?.['ExposureTime'],
    aperture: exif?.['FNumber'],
    focalLength: exif?.['FocalLength'],
    dateTaken: exif?.['DateTimeOriginal'],
    cameraMake: exif?.['Make'],
    cameraModel: exif?.['Model'],
    lensModel: exif?.['LensModel'],
    lens: exif?.['Lens'],
    lensMake: exif?.['LensMake'],
  };
}

function inputsEqual(a: ProjectionInputs, b: ProjectionInputs): boolean {
  for (const key of Object.keys(a) as (keyof ProjectionInputs)[]) {
    if (key === 'tags') continue;
    if (a[key] !== b[key]) return false;
  }
  if (a.tags.length !== b.tags.length) return false;
  for (let index = 0; index < a.tags.length; index++) {
    if (a.tags[index] !== b.tags[index]) return false;
  }
  return true;
}
