import type { ImageFile, SupportedTypes } from '../components/ui/AppProperties';

export interface NormalizedSupportedTypes {
  nonRaw: ReadonlySet<string>;
  raw: ReadonlySet<string>;
}

export interface LibrarySearchProjection {
  path: string;
  entityRevision: number;
  physicalPath: string;
  fileName: string;
  normalizedFileName: string;
  parentDirectory: string;
  extension: string;
  baseName: string;
  rawPairKey: string;
  isRaw: boolean;
  isNonRaw: boolean;
  isEdited: boolean;
  rating: number;
  modified: number;
  dateTaken: string;
  normalizedUserTags: readonly string[];
  colorLabel: string | null;
  cameraSearchText: string;
  lensSearchText: string;
  iso: number;
  shutterSeconds: number;
  aperture: number;
  focalLengthMm: number;
  stableOrdinal: number;
}

export interface ProjectionContext {
  entityRevision: number;
  rating: number;
  stableOrdinal: number;
  supportedTypes: NormalizedSupportedTypes;
}

export const parseShutter = (value: string | undefined): number => {
  if (!value) return 0;
  const cleanValue = value.replace(/s/i, '').trim();
  const separator = cleanValue.indexOf('/');
  if (separator !== -1) {
    const numerator = Number.parseFloat(cleanValue.slice(0, separator));
    const denominator = Number.parseFloat(cleanValue.slice(separator + 1));
    return denominator !== 0 ? numerator / denominator : 0;
  }
  const parsed = Number.parseFloat(cleanValue);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const parseFirstNumber = (value: string | undefined): number => {
  if (!value) return 0;
  const match = /(\d+(\.\d+)?)/.exec(value);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[0]);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const parseAperture = parseFirstNumber;
export const parseFocalLength = parseFirstNumber;

export function buildLibrarySearchProjection(image: ImageFile, context: ProjectionContext): LibrarySearchProjection {
  const virtualCopyIndex = image.path.indexOf('?vc=');
  const physicalPath = virtualCopyIndex === -1 ? image.path : image.path.slice(0, virtualCopyIndex);
  const slashIndex = Math.max(physicalPath.lastIndexOf('/'), physicalPath.lastIndexOf('\\'));
  const fileName = physicalPath.slice(slashIndex + 1);
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
  const parentDirectory = slashIndex === -1 ? '' : physicalPath.slice(0, slashIndex);
  const tags = image.tags ?? [];
  const normalizedUserTags: string[] = [];
  let colorLabel: string | null = null;

  for (const tag of tags) {
    if (colorLabel === null && tag.startsWith('color:')) colorLabel = tag.slice(6);
    normalizedUserTags.push(tag.toLowerCase().replace('user:', ''));
  }

  const exif = image.exif;
  const iso = Number.parseInt(exif?.['PhotographicSensitivity'] ?? exif?.['ISOSpeedRatings'] ?? '0', 10) || 0;

  return {
    path: image.path,
    entityRevision: context.entityRevision,
    physicalPath,
    fileName,
    normalizedFileName: fileName.toLowerCase(),
    parentDirectory,
    extension,
    baseName,
    rawPairKey: `${parentDirectory}/${baseName}`,
    isRaw: context.supportedTypes.raw.has(extension),
    isNonRaw: context.supportedTypes.nonRaw.has(extension),
    isEdited: image.is_edited,
    rating: context.rating,
    modified: image.modified,
    dateTaken: exif?.['DateTimeOriginal'] ?? '',
    normalizedUserTags,
    colorLabel,
    cameraSearchText: `${exif?.['Make'] ?? ''} ${exif?.['Model'] ?? ''}`.toLowerCase(),
    lensSearchText: `${exif?.['LensModel'] ?? ''} ${exif?.['Lens'] ?? ''} ${exif?.['LensMake'] ?? ''}`.toLowerCase(),
    iso,
    shutterSeconds: parseShutter(exif?.['ExposureTime']),
    aperture: parseAperture(exif?.['FNumber']),
    focalLengthMm: parseFocalLength(exif?.['FocalLength']),
    stableOrdinal: context.stableOrdinal,
  };
}

const normalizedSupportedTypesCache = new WeakMap<SupportedTypes, NormalizedSupportedTypes>();

export function normalizeSupportedTypes(supportedTypes: SupportedTypes | null): NormalizedSupportedTypes {
  if (supportedTypes === null) return EMPTY_SUPPORTED_TYPES;
  const cached = normalizedSupportedTypesCache.get(supportedTypes);
  if (cached) return cached;
  const normalized = {
    raw: new Set(supportedTypes.raw.map((extension) => extension.toLowerCase())),
    nonRaw: new Set(supportedTypes.nonRaw.map((extension) => extension.toLowerCase())),
  };
  normalizedSupportedTypesCache.set(supportedTypes, normalized);
  return normalized;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_SUPPORTED_TYPES: NormalizedSupportedTypes = { raw: EMPTY_SET, nonRaw: EMPTY_SET };
